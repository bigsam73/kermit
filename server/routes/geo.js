// 주소 지오코딩 · 필지(지적도식 매핑) · 도면(SHP/DXF) 중첩 API
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { DATA_DIR } from '../lib/datasets.js';
import { geocodeAddress, publicSettings, saveSettings, loadSettings } from '../lib/geocode.js';
import { convertToGeoJson, CRS_CANDIDATES } from '../lib/cad.js';
import { polygonAreaSqm, rectRing } from '../lib/geo.js';
import { broadcast } from '../lib/sim.js';
import { lookupParcelBuildings, USAGE_CATEGORY } from '../lib/buildings.js';

const DRAWING_DIR = path.join(DATA_DIR, 'drawings');
fs.mkdirSync(DRAWING_DIR, { recursive: true });

const safeName = (n) => Buffer.from(n, 'latin1').toString('utf8').replace(/[^\w.\-가-힣]+/g, '_');

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            if (!req.drawingId) req.drawingId = `dr-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
            const dir = path.join(DRAWING_DIR, req.drawingId, 'src');
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, safeName(file.originalname)),
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 40 },
});

const PALETTE = ['#22d3ee', '#f472b6', '#facc15', '#a3e635', '#fb923c', '#c084fc', '#f87171', '#34d399'];

export function geoRouter(store) {
    const r = Router();

    // ── 지오코딩 설정 · 테스트 · 일괄 ─────────────────────────
    r.get('/geocode/settings', (req, res) => res.json(publicSettings()));
    r.put('/geocode/settings', (req, res) => {
        saveSettings(req.body || {});
        res.json(publicSettings());
    });
    r.get('/geocode/test', async (req, res) => res.json(await geocodeAddress(String(req.query.address || ''), { fresh: true })));
    // rows: [{address}] (최대 30건/호출, 순차 처리)
    r.post('/geocode/batch', async (req, res) => {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 30) : [];
        const results = [];
        for (const row of rows) results.push(await geocodeAddress(row.address));
        res.json({ results, settings: publicSettings() });
    });

    // 연속지적도(LP_PA_CBND_BUBUN) 벡터 조회: bbox=west,south,east,north (도). 키는 서버에서만 사용
    r.get('/cadastral/features', async (req, res) => {
        const s = loadSettings();
        if (!s.vworldKey) return res.status(400).json({ error: '브이월드 키가 없습니다' });
        const bb = String(req.query.bbox || '').split(',').map(Number);
        if (bb.length !== 4 || bb.some((n) => !Number.isFinite(n))) return res.status(400).json({ error: 'bbox=west,south,east,north 필요' });
        const [w, so, e, n] = bb;
        if ((e - w) > 0.03 || (n - so) > 0.03) return res.status(400).json({ error: '범위가 너무 큽니다 (최대 0.03도)' });
        const features = [];
        try {
            for (let page = 1; page <= 4; page++) {
                const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN&format=json&geometry=true&attribute=true&crs=EPSG:4326&size=1000&page=${page}&geomFilter=${encodeURIComponent(`BOX(${w},${so},${e},${n})`)}&key=${encodeURIComponent(s.vworldKey)}&domain=${encodeURIComponent(s.vworldDomain)}`;
                const j = await (await fetch(url)).json();
                const rsp = j?.response;
                if (rsp?.status === 'NOT_FOUND') break;
                if (rsp?.status !== 'OK') return res.status(502).json({ error: rsp?.error?.text || 'VWorld 오류' });
                for (const f of rsp.result?.featureCollection?.features || []) {
                    if (f.geometry) features.push({ type: 'Feature', geometry: f.geometry, properties: { jibun: f.properties?.jibun, pnu: f.properties?.pnu, addr: f.properties?.addr, jiga: f.properties?.jiga } });
                }
                if (page >= Number(rsp.page?.total || 1)) break;
            }
            res.set('Cache-Control', 'public, max-age=3600').json({ type: 'FeatureCollection', features });
        } catch (err) {
            res.status(502).json({ error: err.message });
        }
    });

    const FAC_LABELS = { factory: '제조공장', warehouse: '물류창고', office: '사무동', utility: '에너지/유틸리티', treatment: '폐수/폐기물', vacant: '미분양' };

    // 건축물대장 정보를 필지(및 연결된 시설)에 반영. 사용자가 직접 정한 업종 분류는 덮어쓰지 않는다
    const enrichParcel = async (id) => {
        const p = store.get('parcels', id);
        if (!p?.geometry) return { id, ok: false, error: '경계 없음' };
        try {
            const b = await lookupParcelBuildings(p);
            const { buildings, ...sum } = b;
            const patch = { ...sum, buildings };
            const autoCat = USAGE_CATEGORY[b.usageCode];
            if (autoCat && (!p.category || p.categoryAuto)) { patch.category = autoCat; patch.categoryAuto = true; }
            const row = store.update('parcels', id, patch);
            if (row.facilityId && store.get('facilities', row.facilityId)) {
                const fac = {};
                if (b.floors) { fac.floors = b.floors; fac.heightM = b.heightM || b.floors * (row.category === 'office' ? 3.6 : 9); }
                if (b.bldArchAreaSqm) fac.roofAreaSqm = Math.round(b.bldArchAreaSqm);
                if (b.structure) fac.roofType = b.structure;
                if (b.usageName) fac.buildingUse = b.usageName;
                if (row.category) { fac.type = row.category; fac.typeLabel = FAC_LABELS[row.category] || row.category; }
                store.update('facilities', row.facilityId, fac);
            }
            return { id, ok: true, bldCount: b.bldCount, floors: b.floors, usageName: b.usageName };
        } catch (err) {
            return { id, ok: false, error: err.message };
        }
    };
    const enrichMany = async (ids) => {
        const results = [];
        let next = 0;
        const worker = async () => {
            while (next < ids.length) {
                const id = ids[next++];
                results.push(await enrichParcel(id));
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
        return results;
    };

    // 건축물대장(브이월드 건물통합정보) 자동 채움: ids 없으면 단지 전체 (한 번에 최대 80건)
    r.post('/parcels/enrich', async (req, res) => {
        const { siteId, ids } = req.body || {};
        let list = Array.isArray(ids) ? ids : store.list('parcels', siteId ? { siteId } : null).filter((p) => p.geometry).map((p) => p.id);
        list = list.slice(0, 80);
        const results = await enrichMany(list);
        broadcast('parcels', { action: 'update', siteId });
        broadcast('facilities', { action: 'update' });
        res.json({ requested: list.length, ok: results.filter((x) => x.ok).length, withBuildings: results.filter((x) => x.ok && x.bldCount).length, failed: results.filter((x) => !x.ok).length, firstError: results.find((x) => !x.ok)?.error || null });
    });

    // ── 필지 ──────────────────────────────────────────────
    // 폴리곤이 없으면 면적(㎡)이 있을 때 그 면적의 정사각형, 없으면 20 m 사각형으로 근사
    const approxRing = (lon, lat, areaSqm) => {
        const side = areaSqm > 0 ? Math.sqrt(areaSqm) : 20;
        return rectRing(lon, lat, side, side, 0);
    };
    const toParcel = (siteId, batchId, row) => {
        const hasPoly = Array.isArray(row.polygon) && row.polygon[0]?.length >= 4;
        const lon = Number(row.lon);
        const lat = Number(row.lat);
        const ok = Number.isFinite(lon) && Number.isFinite(lat);
        const coords = hasPoly ? row.polygon : ok ? [approxRing(lon, lat, Number(row.areaSqm))] : null;
        return {
            siteId, batchId,
            address: row.address || '',
            name: row.name || row.address || '',
            company: row.company || null,
            lotNo: row.lotNo || null,
            category: row.category || null,
            areaSqm: Number(row.areaSqm) > 0 ? Number(row.areaSqm) : (coords ? Math.round(polygonAreaSqm(coords)) : null),
            lon: ok ? lon : null,
            lat: ok ? lat : null,
            geometry: coords ? { type: 'Polygon', coordinates: coords } : null,
            geometrySource: hasPoly ? row.polygonSource || 'cadastral' : coords ? 'approx' : 'none',
            geocodeStatus: ok ? (row.geocoded === false ? 'manual' : 'ok') : 'failed',
            provider: row.provider || (row.geocoded === false ? 'file' : null),
            accuracy: row.accuracy || null,
            matched: row.matched || null,
            pnu: row.pnu || null,
            error: ok ? null : row.error || '좌표 없음',
            attrs: row.attrs || {},
        };
    };

    r.get('/parcels', (req, res) => {
        const f = {};
        if (req.query.siteId) f.siteId = String(req.query.siteId);
        if (req.query.batchId) f.batchId = String(req.query.batchId);
        res.json(store.list('parcels', Object.keys(f).length ? f : null));
    });
    r.post('/parcels/bulk', (req, res) => {
        const { siteId, batchName, rows } = req.body || {};
        if (!siteId || !Array.isArray(rows)) return res.status(400).json({ error: 'siteId, rows 필요' });
        const batchId = req.body.batchId || `pb-${Date.now().toString(36)}`;
        const existing = new Map(store.list('parcels', { siteId }).filter((p) => p.pnu).map((p) => [p.pnu, p]));
        const inserted = rows.map((row) => {
            const base = { ...toParcel(siteId, batchId, row), batchName: batchName || null };
            const prev = row.pnu ? existing.get(row.pnu) : null;
            if (prev) return store.update('parcels', prev.id, { ...base, ceo: prev.ceo, phone: prev.phone, memo: prev.memo, industry: prev.industry, facilityId: prev.facilityId });
            const rec = store.insert('parcels', base);
            if (rec.pnu) existing.set(rec.pnu, rec);
            return rec;
        });
        broadcast('parcels', { action: 'bulk', siteId, batchId });
        res.status(201).json({ batchId, count: inserted.length, ok: inserted.filter((p) => p.geocodeStatus !== 'failed').length, failed: inserted.filter((p) => p.geocodeStatus === 'failed').length });
    });
    r.put('/parcels/:id', (req, res) => {
        const patch = { ...(req.body || {}) };
        if (Number.isFinite(Number(patch.lon)) && Number.isFinite(Number(patch.lat)) && patch.relocate) {
            // 좌표 수동 보정: 근사 폴리곤이면 새 위치로 다시 생성
            const cur = store.get('parcels', req.params.id);
            if (cur && cur.geometrySource !== 'cadastral') {
                patch.geometry = { type: 'Polygon', coordinates: [approxRing(Number(patch.lon), Number(patch.lat), cur.areaSqm)] };
                patch.geometrySource = 'approx';
            }
            patch.geocodeStatus = 'manual';
            delete patch.relocate;
        }
        const row = store.update('parcels', req.params.id, patch);
        if (!row) return res.status(404).json({ error: 'not found' });
        broadcast('parcels', { action: 'update', siteId: row.siteId });
        res.json(row);
    });
    r.delete('/parcels/:id', (req, res) => {
        const row = store.get('parcels', req.params.id);
        const ok = store.remove('parcels', req.params.id);
        if (row) broadcast('parcels', { action: 'delete', siteId: row.siteId });
        res.json({ ok });
    });
    // 배치 단위 삭제: DELETE /parcels?siteId=&batchId=
    r.delete('/parcels', (req, res) => {
        const siteId = String(req.query.siteId || '');
        const batchId = String(req.query.batchId || '');
        if (!siteId) return res.status(400).json({ error: 'siteId 필요' });
        const rows = store.list('parcels', { siteId, ...(batchId ? { batchId } : {}) });
        rows.forEach((p) => store.remove('parcels', p.id));
        broadcast('parcels', { action: 'delete', siteId });
        res.json({ removed: rows.length });
    });
    // 실패 건 재지오코딩 (주소 수정 후)
    r.post('/parcels/:id/geocode', async (req, res) => {
        const cur = store.get('parcels', req.params.id);
        if (!cur) return res.status(404).json({ error: 'not found' });
        const address = req.body?.address || cur.address;
        const g = await geocodeAddress(address, { fresh: true });
        if (!g.ok) return res.json({ ok: false, error: g.error });
        const p = toParcel(cur.siteId, cur.batchId, { ...cur, address, lon: g.lon, lat: g.lat, polygon: g.polygon, polygonSource: g.polygonSource, provider: g.provider, accuracy: g.accuracy, matched: g.matched, pnu: g.pnu, areaSqm: cur.areaSqm });
        const row = store.update('parcels', cur.id, { ...p, batchId: cur.batchId, batchName: cur.batchName, attrs: cur.attrs });
        broadcast('parcels', { action: 'update', siteId: cur.siteId });
        res.json({ ok: true, row });
    });
    // 지적도에서 고른 필지(들)에 상호·회사정보 기입 (PNU 기준 upsert)
    r.post('/parcels/lots', async (req, res) => {
        const { siteId, lots, info = {} } = req.body || {};
        if (!siteId || !Array.isArray(lots) || !lots.length) return res.status(400).json({ error: 'siteId, lots 필요' });
        const company = String(info.company || '').trim();
        if (!company) return res.status(400).json({ error: '상호를 입력하세요' });
        const batchId = `lot-${Date.now().toString(36)}`;
        const fields = {
            name: company, company,
            ceo: info.ceo || null, phone: info.phone || null, memo: info.memo || null, industry: info.industry || null,
            category: info.category || null, categoryAuto: !info.category,
        };
        const rows = [];
        for (const lot of lots) {
            if (!Array.isArray(lot.polygon) || !lot.polygon[0]?.length) continue;
            const prev = lot.pnu ? store.list('parcels', { siteId }).find((p) => p.pnu === lot.pnu) : null;
            const area = Math.round(polygonAreaSqm(lot.polygon));
            const base = { ...fields, siteId, address: lot.addr || prev?.address || '', lotNo: lot.jibun || prev?.lotNo || null, pnu: lot.pnu || null, areaSqm: area, lon: lot.lon, lat: lot.lat, geometry: { type: 'Polygon', coordinates: lot.polygon }, geometrySource: 'cadastral', geocodeStatus: 'manual', provider: 'cadastral-click', accuracy: 'parcel', error: null };
            rows.push(prev ? store.update('parcels', prev.id, base) : store.insert('parcels', { ...base, batchId, batchName: '지적도 클릭 기입', attrs: {} }));
        }
        const enrich = await enrichMany(rows.map((x) => x.id));
        broadcast('parcels', { action: 'bulk', siteId });
        broadcast('facilities', { action: 'update' });
        res.status(201).json({ count: rows.length, rows: rows.map((x) => store.get('parcels', x.id)), enrich: { ok: enrich.filter((x) => x.ok).length, withBuildings: enrich.filter((x) => x.ok && x.bldCount).length, floors: enrich.find((x) => x.floors)?.floors || null, usageName: enrich.find((x) => x.usageName)?.usageName || null, error: enrich.find((x) => !x.ok)?.error || null } });
    });

    // 필지 → 시설·입주기업 등록
    r.post('/parcels/to-facilities', (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const out = [];
        for (const id of ids) {
            const p = store.get('parcels', id);
            if (!p || !p.geometry || p.facilityId) continue;
            const site = store.get('sites', p.siteId);
            const ring = p.geometry.coordinates[0];
            const roofArea = Math.round(polygonAreaSqm(p.geometry.coordinates));
            const company = p.company || null;
            const fac = store.insert('facilities', {
                siteId: p.siteId,
                name: company ? `${company} ${p.lotNo || ''}`.trim() : p.name || p.address,
                company,
                type: p.category && ['factory', 'warehouse', 'office', 'utility', 'treatment', 'vacant'].includes(p.category) ? p.category : company ? 'factory' : 'vacant',
                typeLabel: FAC_LABELS[p.category] || '제조공장',
                lotNo: p.lotNo || p.address || `${site?.code || 'P'}-${id.slice(-4)}`,
                address: p.address,
                parcelId: p.id,
                lon: p.lon, lat: p.lat,
                floors: p.floors || 1, heightM: p.heightM || (p.floors ? p.floors * (p.category === 'office' ? 3.6 : 9) : 9), roofType: p.structure || '-', roofAreaSqm: p.bldArchAreaSqm ? Math.round(p.bldArchAreaSqm) : roofArea, lotAreaSqm: p.areaSqm || roofArea, buildingUse: p.usageName || null,
                geometry: { type: 'Polygon', coordinates: [ring] },
                lotGeometry: { type: 'Polygon', coordinates: [ring] },
                status: company ? 'operating' : 'vacant', hazard: '-', employees: 0, energyKwhMonth: 0, contact: p.phone || null, ceo: p.ceo || null, industry: p.industry || null, pvInstalled: false,
                lastInspection: null, riskScore: 0,
            });
            store.update('parcels', p.id, { facilityId: fac.id });
            out.push(fac.id);
        }
        broadcast('facilities', { action: 'bulk' });
        broadcast('parcels', { action: 'update' });
        res.json({ created: out.length, facilityIds: out });
    });

    // ── 도면(SHP / DXF) ───────────────────────────────────
    r.get('/drawings/crs', (req, res) => res.json(CRS_CANDIDATES.map(({ epsg, label }) => ({ epsg, label }))));
    r.get('/drawings', (req, res) => res.json(store.list('drawings', req.query.siteId ? { siteId: String(req.query.siteId) } : null)));
    r.get('/drawings/:id', (req, res) => {
        const d = store.get('drawings', req.params.id);
        return d ? res.json(d) : res.status(404).json({ error: 'not found' });
    });
    r.get('/drawings/:id/geojson', (req, res) => {
        const file = path.join(DRAWING_DIR, req.params.id, 'out.geojson');
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'geojson not found' });
        res.type('application/geo+json').sendFile(file);
    });

    const sourceFiles = (id) => {
        const dir = path.join(DRAWING_DIR, id, 'src');
        return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => ({ name: n, path: path.join(dir, n) })) : [];
    };
    const nearOf = (siteId) => {
        const s = store.get('sites', siteId);
        return s?.lon != null ? { lon: s.lon, lat: s.lat } : null;
    };

    r.post('/drawings/upload', upload.array('files', 40), async (req, res) => {
        const id = req.drawingId;
        try {
            if (!id || !req.files?.length) return res.status(400).json({ error: '파일이 없습니다' });
            const { siteId, srcEpsg = 'auto', encoding = 'auto' } = req.body || {};
            const files = sourceFiles(id);
            const outFile = path.join(DRAWING_DIR, id, 'out.geojson');
            const info = await convertToGeoJson(files, outFile, { srcEpsg, encoding, near: nearOf(siteId) });
            const main = files.find((f) => /\.(shp|dxf|geojson|json|kml|gpkg|zip)$/i.test(f.name)) || files[0];
            const n = store.list('drawings', { siteId }).length;
            const row = store.insert('drawings', {
                id, siteId,
                name: req.body?.name || main.name.replace(/\.[^.]+$/, ''),
                kind: info.kind, files: files.map((f) => f.name),
                featureCount: info.featureCount, bounds: info.bounds, layers: info.layers, geomTypes: info.geomTypes, fields: info.fields, crs: info.crs,
                srcEpsg, encoding, sizeBytes: info.sizeBytes,
                color: PALETTE[n % PALETTE.length], opacity: 0.85, lineWidth: 1.5, clamp: true, showLabels: true, visible: true, hiddenLayers: [],
                geojsonUrl: `/api/drawings/${id}/geojson`,
            });
            broadcast('drawings', { action: 'insert', siteId });
            res.status(201).json(row);
        } catch (err) {
            if (id) fs.rmSync(path.join(DRAWING_DIR, id), { recursive: true, force: true });
            res.status(422).json({ error: err.message });
        }
    });
    // 좌표계/인코딩을 바꿔 다시 변환 (재업로드 불필요)
    r.post('/drawings/:id/reconvert', async (req, res) => {
        const d = store.get('drawings', req.params.id);
        if (!d) return res.status(404).json({ error: 'not found' });
        try {
            const { srcEpsg = 'auto', encoding = 'auto' } = req.body || {};
            const info = await convertToGeoJson(sourceFiles(d.id), path.join(DRAWING_DIR, d.id, 'out.geojson'), { srcEpsg, encoding, near: nearOf(d.siteId) });
            const row = store.update('drawings', d.id, { featureCount: info.featureCount, bounds: info.bounds, layers: info.layers, geomTypes: info.geomTypes, fields: info.fields, crs: info.crs, srcEpsg, encoding, sizeBytes: info.sizeBytes, hiddenLayers: [], geojsonRev: Date.now() });
            broadcast('drawings', { action: 'update', siteId: d.siteId });
            res.json(row);
        } catch (err) {
            res.status(422).json({ error: err.message });
        }
    });
    r.put('/drawings/:id', (req, res) => {
        const patch = { ...(req.body || {}) };
        for (const k of ['id', 'siteId', 'files', 'geojsonUrl', 'bounds', 'layers']) delete patch[k];
        const row = store.update('drawings', req.params.id, patch);
        if (!row) return res.status(404).json({ error: 'not found' });
        broadcast('drawings', { action: 'update', siteId: row.siteId });
        res.json(row);
    });
    r.delete('/drawings/:id', (req, res) => {
        const d = store.get('drawings', req.params.id);
        const ok = store.remove('drawings', req.params.id);
        if (d) {
            fs.rmSync(path.join(DRAWING_DIR, d.id), { recursive: true, force: true });
            broadcast('drawings', { action: 'delete', siteId: d.siteId });
        }
        res.json({ ok });
    });

    return r;
}
