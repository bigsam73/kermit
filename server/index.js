// PICT INDUSTRIAL - 산업단지 통합 관제 플랫폼 API/정적 서버
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Store } from './lib/store.js';
import { DATA_DIR, TILES_DIR, PREVIEW_DIR, UPLOAD_DIR, THUMB_DIR, processRasterDataset, RASTER_TYPES } from './lib/datasets.js';
import { sseHandler, startSimulator, broadcast, clientCount } from './lib/sim.js';
import { seedDatabase } from './seed.js';
import { coreRouter } from './routes/core.js';
import { datasetsRouter } from './routes/datasets.js';
import { externalRouter } from './routes/external.js';
import { findGdal, gdalStatus } from './lib/gdal.js';
import { analyzeThermal } from './lib/thermal.js';
import { arrayHealthFromHotspots } from './lib/pv.js';

const PORT = Number(process.env.PORT || 3200);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');

const store = new Store(path.join(DATA_DIR, 'db.json'));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// 대용량 업로드 타임아웃
app.use((req, res, next) => {
    if (req.url.includes('/api/datasets/upload')) {
        req.setTimeout(60 * 60 * 1000);
        res.setTimeout(60 * 60 * 1000);
    }
    next();
});

// SSE
app.get('/events', sseHandler);

// 외부 타일 폴더(DJI Terra 등) 서빙: 데이터셋에 tilesDir가 있으면 그 폴더에서 읽는다
app.get('/tiles/:id/:z/:x/:file', (req, res, next) => {
    const ds = store.get('datasets', req.params.id);
    if (!ds?.tilesDir) return next();
    const { z, x, file } = req.params;
    if (!/^\d{1,2}$/.test(z) || !/^\d+$/.test(x) || !/^\d+\.(png|jpg|jpeg|webp)$/i.test(file)) return res.status(400).end();
    const target = path.join(ds.tilesDir, z, x, file);
    if (!target.startsWith(path.resolve(ds.tilesDir))) return res.status(403).end();
    if (!fs.existsSync(target)) return res.status(204).end();
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(target);
});
// 정적 데이터
app.use('/tiles', express.static(TILES_DIR, { maxAge: '7d', fallthrough: true }));
app.use('/previews', express.static(PREVIEW_DIR, { maxAge: '1d' }));
app.use('/thumbs', express.static(THUMB_DIR, { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// 3D Tiles: 등록된 데이터셋의 로컬 폴더만 노출
app.get('/3dtiles/:id/*splat', (req, res) => {
    const ds = store.get('datasets', req.params.id);
    if (!ds || (ds.type !== '3dtiles' && ds.type !== 'pointcloud')) return res.status(404).end();
    const baseDir = path.dirname(ds.sourcePath);
    const rel = Array.isArray(req.params.splat) ? req.params.splat.join('/') : String(req.params.splat || '');
    const target = path.resolve(baseDir, rel);
    if (!target.startsWith(path.resolve(baseDir))) return res.status(403).end();
    if (!fs.existsSync(target)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(target);
});

const sim = startSimulator(store, Number(process.env.TELEMETRY_INTERVAL_MS || 5000));

app.use('/api', coreRouter(store, sim));
app.use('/api', datasetsRouter(store));
app.use('/api', externalRouter(store));

app.get('/api/health', (req, res) => res.json({ ok: true, sse: clientCount(), gdal: gdalStatus(), sites: store.list('sites').length, now: new Date().toISOString() }));

// 시드 재생성
app.post('/api/system/reseed', async (req, res) => {
    await seedDatabase(store);
    await postSeed();
    broadcast('reseed', { at: new Date().toISOString() });
    res.json({ ok: true });
});

// 프로덕션 빌드 정적 서빙
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get(/^(?!\/api|\/events|\/tiles|\/3dtiles|\/previews|\/thumbs|\/uploads).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

app.use((err, req, res, next) => {
    console.error('[api]', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message });
});

// 시드 후처리: 열화상 자동 분석(대표 데이터셋) + 정사영상 타일/외부 타일 연결 (백그라운드)
async function postSeed() {
    // 외부 타일(DJI Terra) 연결과 메타 추출을 먼저 수행 (빠름)
    if (findGdal()) {
        const rasters = store.list('datasets').filter((d) => RASTER_TYPES.has(d.type) && !d.isSynthetic && d.status === 'registered' && d.autoProcess !== false);
        for (const ds of rasters) await processRasterDataset(store, ds, { tiles: ds.type === 'orthophoto' });
    }
    const thermal = store.list('datasets', { type: 'thermal' }).filter((d) => d.isPrimaryThermal);
    for (const ds of thermal) {
        try {
            const arrays = store.list('panelArrays', { siteId: ds.siteId });
            console.log(`[seed] 열화상 분석 시작: ${ds.name}`);
            const analysis = await analyzeThermal(ds.sourcePath, { panelArrays: arrays, deltaThreshold: 15, rawIsTemperature: true, maxDim: ds.isSynthetic ? 1024 : 3000 });
            store.list('hotspots', { datasetId: ds.id }).forEach((h) => store.remove('hotspots', h.id));
            const now = new Date().toISOString();
            const rows = analysis.hotspots.map((h, i) => store.insert('hotspots', { ...h, datasetId: ds.id, siteId: ds.siteId, index: i + 1, status: 'open', detectedAt: now }));
            store.insert('inspections', { siteId: ds.siteId, datasetId: ds.id, datasetName: ds.name, type: 'thermal', params: { deltaThreshold: 15 }, stats: analysis.stats, background: analysis.background, threshold: analysis.threshold, hotspotCount: analysis.hotspotCount, bySeverity: rows.reduce((m, r) => ({ ...m, [r.severity]: (m[r.severity] || 0) + 1 }), {}), pvHotspots: rows.filter((h) => h.arrayId).length });
            for (const a of arrays) {
                const health = arrayHealthFromHotspots(a, rows);
                store.update('panelArrays', a.id, { health, lastThermalInspection: now.slice(0, 10) });
                if (health.status === 'critical' || health.status === 'warning') {
                    const top = rows.filter((h) => h.arrayId === a.id).sort((x, y) => y.maxT - x.maxT)[0];
                    store.insert('alerts', { siteId: ds.siteId, level: health.status === 'critical' ? 'critical' : 'warning', category: 'solar', title: `${a.name} 열 이상 ${health.hotspotCount}건`, message: `최고 ${top?.maxT}°C (배경 대비 +${top?.deltaT}°C). 바이패스 다이오드/셀 결함 또는 오염 의심. 현장 점검 필요.`, lon: top?.lon, lat: top?.lat, refType: 'panelArray', refId: a.id, acknowledged: false, source: 'thermal-analysis' });
                }
            }
            store.update('datasets', ds.id, { lastAnalysisAt: now, hotspotCount: analysis.hotspotCount, thermalStats: analysis.stats, status: 'ready' });
            console.log(`[seed] 열화상 분석: ${ds.name} → 핫스팟 ${analysis.hotspotCount}건`);
        } catch (err) {
            console.warn('[seed] thermal analysis failed:', err.message);
        }
    }
    // 합성 열화상은 미리보기만 생성 (타일 불필요)
    for (const ds of thermal) if (findGdal() && ds.isSynthetic && !ds.previewUrl) processRasterDataset(store, ds, { tiles: false });
    store.save(true);
}

(async () => {
    if (store.isEmpty() || process.env.RESEED === '1') {
        await seedDatabase(store);
        await postSeed();
    }
    // 예전 개발 포트(5174)로 열어 둔 탭이 있어도 3200으로 안내 (2026-10-19 단일 포트 통합)
    const LEGACY_PORT = Number(process.env.LEGACY_PORT || 5174);
    if (LEGACY_PORT && LEGACY_PORT !== PORT) {
        const legacy = express();
        legacy.use((req, res) => res.redirect(301, `http://${req.hostname}:${PORT}${req.originalUrl}`));
        legacy.listen(LEGACY_PORT, '0.0.0.0', () => console.log(`[godseye-industrial] legacy port ${LEGACY_PORT} → redirect to ${PORT}`)).on('error', () => {});
    }
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[godseye-industrial] API http://localhost:${PORT}  (GDAL: ${gdalStatus().available ? gdalStatus().dir : '없음'})`);
        console.log(`[godseye-industrial] data dir: ${DATA_DIR}`);
    });
})();
