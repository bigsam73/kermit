// 데이터셋(위성/정사영상/열화상/3D Tiles/사진) 관리 + 열화상 분석 + 드론 사진 인덱스
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_DIR, THUMB_DIR, RASTER_TYPES, processRasterDataset, extractRasterMeta } from '../lib/datasets.js';
import { analyzeThermal, thermalGridPayload } from '../lib/thermal.js';
import { arrayHealthFromHotspots } from '../lib/pv.js';
import { listJobs, getJob, runJob } from '../lib/jobs.js';
import { walkImages, readPhotoMeta, makeThumb } from '../lib/photos.js';
import { gdalStatus } from '../lib/gdal.js';
import { broadcast } from '../lib/sim.js';

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => {
            const safe = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^\w.\-가-힣]+/g, '_');
            cb(null, `${Date.now()}-${safe}`);
        },
    }),
    limits: { fileSize: 8 * 1024 * 1024 * 1024 },
});

export function datasetsRouter(store) {
    const r = Router();

    r.get('/datasets', (req, res) => {
        const filter = req.query.siteId ? { siteId: String(req.query.siteId) } : null;
        res.json(store.list('datasets', filter));
    });
    r.get('/datasets/:id', (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds) return res.status(404).json({ error: 'not found' });
        res.json(ds);
    });
    r.put('/datasets/:id', (req, res) => {
        const ds = store.update('datasets', req.params.id, req.body || {});
        if (!ds) return res.status(404).json({ error: 'not found' });
        broadcast('dataset', ds);
        res.json(ds);
    });
    r.delete('/datasets/:id', (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (ds?.uploaded && ds.sourcePath && fs.existsSync(ds.sourcePath)) {
            try {
                fs.unlinkSync(ds.sourcePath);
            } catch {
                /* ignore */
            }
        }
        store.list('hotspots', { datasetId: req.params.id }).forEach((h) => store.remove('hotspots', h.id));
        res.json({ ok: store.remove('datasets', req.params.id) });
    });

    // 로컬 경로 등록 (서버 PC에 이미 있는 파일/폴더)
    // DJI Terra 결과: map/result.tif 옆에 {z}/{x}/{y}.png 타일 폴더가 있으면 자동으로 연결한다.
    r.post('/datasets/register', async (req, res) => {
        const { siteId, name, type, sourcePath, capturedAt, platform, source = 'drone', process = true, rawIsTemperature } = req.body || {};
        if (!sourcePath || !fs.existsSync(sourcePath)) return res.status(400).json({ error: '경로가 존재하지 않습니다' });
        let tilesDir = req.body?.tilesDir;
        if (!tilesDir && /\.tiff?$/i.test(sourcePath) && type !== 'dsm' && type !== 'ndvi') {
            const dir = path.dirname(sourcePath);
            const base = path.basename(sourcePath).replace(/\.tiff?$/i, '');
            const sibling = path.join(dir, base);
            if (fs.existsSync(sibling) && fs.statSync(sibling).isDirectory()) tilesDir = sibling;
            else if (base === 'result' && (fs.existsSync(path.join(dir, '12')) || fs.existsSync(path.join(dir, '15')))) tilesDir = dir;
        }
        const ds = store.insert('datasets', { siteId, name: name || path.basename(sourcePath), type: type || 'orthophoto', source, platform, sourcePath, tilesDir, capturedAt, rawIsTemperature: type === 'thermal' ? rawIsTemperature !== false : undefined, isPrimaryThermal: type === 'thermal' ? true : undefined, status: 'registered', tilesStatus: 'none' });
        if (ds.type === '3dtiles' || ds.type === 'pointcloud') {
            store.update('datasets', ds.id, { tilesetUrl: `/3dtiles/${ds.id}/${path.basename(sourcePath)}`, status: 'ready' });
        } else if (RASTER_TYPES.has(ds.type) && process) {
            processRasterDataset(store, ds);
        }
        res.status(201).json(store.get('datasets', ds.id));
    });

    // 파일 업로드 등록
    r.post('/datasets/upload', upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });
        const { siteId, name, type = 'orthophoto', capturedAt, platform, source = 'drone' } = req.body || {};
        const ds = store.insert('datasets', { siteId, name: name || req.file.originalname, type, source, platform, sourcePath: req.file.path, uploaded: true, sizeBytes: req.file.size, capturedAt, status: 'registered', tilesStatus: 'none' });
        if (RASTER_TYPES.has(type)) processRasterDataset(store, ds);
        res.status(201).json(ds);
    });

    r.post('/datasets/:id/process', (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds) return res.status(404).json({ error: 'not found' });
        if (!RASTER_TYPES.has(ds.type)) return res.status(400).json({ error: '래스터 데이터셋만 처리할 수 있습니다' });
        processRasterDataset(store, ds, { tiles: req.body?.tiles !== false });
        res.json({ ok: true });
    });

    r.get('/datasets/:id/meta', async (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds) return res.status(404).json({ error: 'not found' });
        try {
            res.json(await extractRasterMeta(ds.sourcePath));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 열화상 그리드 (클라이언트 컬러맵 렌더용)
    r.get('/datasets/:id/thermal-grid', async (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds) return res.status(404).json({ error: 'not found' });
        try {
            const payload = await thermalGridPayload(ds.sourcePath, { maxDim: Number(req.query.maxDim) || 768, rawIsTemperature: ds.rawIsTemperature, scaleMin: ds.scaleMin, scaleMax: ds.scaleMax });
            res.json({ datasetId: ds.id, ...payload });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 열화상 분석 실행 → hotspots/inspections/alerts 갱신, 어레이 건전성 반영
    r.post('/datasets/:id/analyze-thermal', async (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds) return res.status(404).json({ error: 'not found' });
        const { deltaThreshold = 15, absoluteThreshold = null, minPixels = 3, nonPvDeltaThreshold = null, maxHotspots = 300 } = req.body || {};
        const { job, result, error } = await runJob('thermal-analysis', { datasetId: ds.id, siteId: ds.siteId }, async (update) => {
            update({ progress: 10, logLine: '래스터 읽기' });
            const arrays = store.list('panelArrays', { siteId: ds.siteId });
            const analysis = await analyzeThermal(ds.sourcePath, { panelArrays: arrays, deltaThreshold: Number(deltaThreshold), absoluteThreshold: absoluteThreshold === null ? null : Number(absoluteThreshold), minPixels: Number(minPixels), nonPvDeltaThreshold: nonPvDeltaThreshold === null || nonPvDeltaThreshold === '' ? undefined : Number(nonPvDeltaThreshold), maxHotspots: Number(maxHotspots) || 300, rawIsTemperature: ds.rawIsTemperature, scaleMin: ds.scaleMin, scaleMax: ds.scaleMax, maxDim: ds.isSynthetic ? 1024 : Number(req.body?.maxDim) || 3000 });
            update({ progress: 70, logLine: `핫스팟 ${analysis.hotspotCount}건` });
            // 기존 결과 교체: 같은 비행(단지·촬영일 동일)의 방사율 변형 데이터셋은 같은 영상이므로 결과를 하나만 유지한다
            const sameFlight = store.list('datasets', { siteId: ds.siteId }).filter((d) => d.type === 'thermal' && (d.id === ds.id || (d.capturedAt && d.capturedAt === ds.capturedAt && Boolean(d.isSynthetic) === Boolean(ds.isSynthetic))));
            for (const d of sameFlight) store.list('hotspots', { datasetId: d.id }).forEach((h) => store.remove('hotspots', h.id));
            const now = new Date().toISOString();
            const rows = analysis.hotspots.map((h, i) => store.insert('hotspots', { ...h, datasetId: ds.id, siteId: ds.siteId, index: i + 1, status: 'open', detectedAt: now }));
            const inspection = store.insert('inspections', { siteId: ds.siteId, datasetId: ds.id, datasetName: ds.name, type: 'thermal', params: { deltaThreshold, absoluteThreshold, minPixels }, stats: analysis.stats, background: analysis.background, threshold: analysis.threshold, hotspotCount: analysis.hotspotCount, bySeverity: countBy(rows, 'severity'), pvHotspots: rows.filter((h) => h.arrayId).length });
            // 어레이 건전성
            for (const a of arrays) {
                const health = arrayHealthFromHotspots(a, rows);
                store.update('panelArrays', a.id, { health, lastThermalInspection: now.slice(0, 10) });
                if (health.status === 'critical' || health.status === 'warning') {
                    const exists = store.list('alerts', { siteId: ds.siteId }).find((al) => al.refId === a.id && !al.acknowledged);
                    if (!exists) {
                        const top = rows.filter((h) => h.arrayId === a.id).sort((x, y) => y.maxT - x.maxT)[0];
                        store.insert('alerts', { siteId: ds.siteId, level: health.status === 'critical' ? 'critical' : 'warning', category: 'solar', title: `${a.name} 열 이상 ${health.hotspotCount}건`, message: `최고 ${top?.maxT}°C (배경 대비 +${top?.deltaT}°C). 바이패스 다이오드/셀 결함 또는 오염 의심. 현장 점검 필요.`, lon: top?.lon, lat: top?.lat, refType: 'panelArray', refId: a.id, acknowledged: false, source: 'thermal-analysis' });
                    }
                }
            }
            store.update('datasets', ds.id, { lastAnalysisAt: now, hotspotCount: analysis.hotspotCount, thermalStats: analysis.stats });
            broadcast('thermal', { siteId: ds.siteId, datasetId: ds.id, inspectionId: inspection.id, hotspotCount: analysis.hotspotCount });
            broadcast('alerts', { action: 'refresh' });
            update({ progress: 95 });
            return { inspectionId: inspection.id, hotspotCount: analysis.hotspotCount, stats: analysis.stats, threshold: analysis.threshold, background: analysis.background };
        });
        if (error) return res.status(500).json({ error: error.message, jobId: job.id });
        res.json({ jobId: job.id, ...result });
    });

    r.get('/hotspots', (req, res) => {
        const filter = {};
        if (req.query.siteId) filter.siteId = String(req.query.siteId);
        if (req.query.datasetId) filter.datasetId = String(req.query.datasetId);
        res.json(store.list('hotspots', Object.keys(filter).length ? filter : null));
    });
    // 데이터셋의 핫스팟 결과 일괄 삭제
    r.delete('/datasets/:id/hotspots', (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds) return res.status(404).json({ error: 'not found' });
        const rows = store.list('hotspots', { datasetId: ds.id });
        rows.forEach((h) => store.remove('hotspots', h.id));
        broadcast('thermal', { datasetId: ds.id, siteId: ds.siteId, removed: rows.length });
        res.json({ removed: rows.length });
    });

    r.put('/hotspots/:id', (req, res) => {
        const row = store.update('hotspots', req.params.id, req.body || {});
        if (!row) return res.status(404).json({ error: 'not found' });
        res.json(row);
    });
    r.get('/inspections', (req, res) => {
        const filter = req.query.siteId ? { siteId: String(req.query.siteId) } : null;
        res.json(store.list('inspections', filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });

    // 드론 사진 폴더 인덱싱 (EXIF GPS)
    r.post('/datasets/:id/index-photos', async (req, res) => {
        const ds = store.get('datasets', req.params.id);
        if (!ds || !ds.sourcePath) return res.status(404).json({ error: 'not found' });
        const limit = Math.min(5000, Number(req.body?.limit) || 1500);
        const { job, result, error } = await runJob('photo-index', { datasetId: ds.id, siteId: ds.siteId }, async (update) => {
            const files = walkImages(ds.sourcePath, limit);
            update({ logLine: `${files.length}개 파일 발견` });
            store.list('photos', { datasetId: ds.id }).forEach((p) => store.remove('photos', p.id));
            const rows = [];
            for (let i = 0; i < files.length; i++) {
                const meta = await readPhotoMeta(files[i]);
                const thumb = await makeThumb(files[i], THUMB_DIR, meta.id);
                rows.push(store.insert('photos', { ...meta, datasetId: ds.id, siteId: ds.siteId, thumbUrl: thumb ? `/thumbs/${meta.id}.jpg` : null }));
                if (i % 25 === 0) update({ progress: Math.round((i / files.length) * 100), logLine: `${i}/${files.length}` });
            }
            const withGps = rows.filter((p) => p.lat !== null);
            store.update('datasets', ds.id, { photoCount: rows.length, photoWithGps: withGps.length, status: 'ready', bounds: withGps.length ? { west: Math.min(...withGps.map((p) => p.lon)), east: Math.max(...withGps.map((p) => p.lon)), south: Math.min(...withGps.map((p) => p.lat)), north: Math.max(...withGps.map((p) => p.lat)) } : null });
            broadcast('photos', { datasetId: ds.id, count: rows.length });
            return { count: rows.length, withGps: withGps.length };
        });
        if (error) return res.status(500).json({ error: error.message, jobId: job.id });
        res.json({ jobId: job.id, ...result });
    });
    r.get('/photos', (req, res) => {
        const filter = {};
        if (req.query.siteId) filter.siteId = String(req.query.siteId);
        if (req.query.datasetId) filter.datasetId = String(req.query.datasetId);
        const rows = store.list('photos', Object.keys(filter).length ? filter : null);
        res.json(rows.slice(0, Number(req.query.limit) || 3000));
    });
    r.get('/photos/:id/file', (req, res) => {
        const p = store.get('photos', req.params.id);
        if (!p || !fs.existsSync(p.file)) return res.status(404).end();
        res.sendFile(p.file);
    });

    r.get('/jobs', (req, res) => res.json(listJobs()));
    r.get('/jobs/:id', (req, res) => {
        const job = getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'not found' });
        res.json(job);
    });
    r.get('/system/status', (req, res) => {
        res.json({ gdal: gdalStatus(), node: process.version, uptimeSec: Math.round(process.uptime()), dataDir: path.resolve('data'), now: new Date().toISOString() });
    });

    return r;
}

function countBy(rows, key) {
    return rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] || 0) + 1 }), {});
}
