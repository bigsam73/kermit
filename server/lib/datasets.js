// 데이터셋 처리 파이프라인: 메타 추출 -> WGS84 미리보기 -> XYZ 타일
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gdalInfo, makePreview, warpToWgs84, makeTiles, findGdal } from './gdal.js';
import { readRasterGrid } from './raster.js';
import { runJob } from './jobs.js';
import { broadcast } from './sim.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.resolve(process.env.INDUSTRIAL_DATA_DIR || path.join(PROJECT_ROOT, 'data'));
export const TILES_DIR = path.join(DATA_DIR, 'tiles');
export const PREVIEW_DIR = path.join(DATA_DIR, 'previews');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
export const SYNTH_DIR = path.join(DATA_DIR, 'synthetic');

for (const d of [TILES_DIR, PREVIEW_DIR, UPLOAD_DIR, THUMB_DIR, SYNTH_DIR]) fs.mkdirSync(d, { recursive: true });

export const RASTER_TYPES = new Set(['orthophoto', 'thermal', 'satellite', 'dsm', 'ndvi']);

export async function extractRasterMeta(file) {
    const meta = {};
    try {
        const info = await gdalInfo(file);
        if (info) {
            meta.width = info.size?.[0];
            meta.height = info.size?.[1];
            meta.bands = info.bands?.length;
            meta.dataType = info.bands?.[0]?.type;
            const m = String(info.coordinateSystem?.wkt || '').match(/ID\["EPSG",(\d+)\]\]\s*$/);
            meta.epsg = m ? Number(m[1]) : null;
            meta.crsName = String(info.coordinateSystem?.wkt || '').match(/^[A-Z]+\["([^"]+)"/)?.[1] || null;
            const ring = info.wgs84Extent?.coordinates?.[0];
            if (ring) {
                const lons = ring.map((c) => c[0]);
                const lats = ring.map((c) => c[1]);
                meta.bounds = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
                meta.footprint = ring;
            }
            const gsd = info.geoTransform ? Math.abs(info.geoTransform[1]) : null;
            if (gsd) meta.gsd = meta.epsg === 4326 ? gsd * 111320 : gsd;
            return meta;
        }
    } catch (err) {
        meta.gdalError = err.message;
    }
    // geotiff.js fallback
    const grid = await readRasterGrid(file, { maxDim: 64 });
    meta.width = grid.fullWidth;
    meta.height = grid.fullHeight;
    meta.epsg = grid.epsg;
    meta.bounds = grid.bounds;
    meta.bands = grid.samples;
    meta.dataType = grid.isFloat ? 'Float32' : 'Byte';
    return meta;
}

// 미리보기: WGS84 재투영 사본 -> PNG (bounds는 재투영 사본 기준)
export async function buildPreview(dataset, update) {
    if (!findGdal()) throw new Error('GDAL 없음: 미리보기 생략');
    const warped = path.join(PREVIEW_DIR, `${dataset.id}-wgs84.tif`);
    const png = path.join(PREVIEW_DIR, `${dataset.id}.png`);
    update?.({ progress: 10, logLine: 'WGS84 재투영 중' });
    await warpToWgs84(dataset.sourcePath, warped, 2048);
    update?.({ progress: 60, logLine: 'PNG 생성 중' });
    const extra = dataset.type === 'thermal' ? ['-ot', 'Byte', '-scale'] : [];
    await makePreview(warped, png, 2048, extra);
    const info = await gdalInfo(warped);
    const ring = info?.wgs84Extent?.coordinates?.[0];
    let bounds = dataset.bounds;
    if (ring) {
        const lons = ring.map((c) => c[0]);
        const lats = ring.map((c) => c[1]);
        bounds = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
    }
    try {
        fs.unlinkSync(warped);
    } catch {
        /* keep */
    }
    try {
        fs.unlinkSync(`${png}.aux.xml`);
    } catch {
        /* none */
    }
    return { previewUrl: `/previews/${dataset.id}.png`, previewBounds: bounds };
}

export async function buildTiles(dataset, update) {
    const outDir = path.join(TILES_DIR, dataset.id);
    const maxZoom = dataset.maxZoom || (dataset.gsd && dataset.gsd < 0.1 ? 21 : dataset.gsd && dataset.gsd < 0.3 ? 20 : 19);
    update?.({ progress: 5, logLine: `타일 생성 시작 (z12-${maxZoom})` });
    let lastPct = 0;
    await makeTiles(dataset.sourcePath, outDir, {
        minZoom: 12, maxZoom,
        onProgress: (chunk) => {
            const m = chunk.match(/(\d{1,3})(?:\.\d+)?%/g);
            if (m) {
                const pct = Number(m[m.length - 1].replace('%', ''));
                if (pct > lastPct) {
                    lastPct = pct;
                    update?.({ progress: 5 + Math.round(pct * 0.9) });
                }
            }
        },
    });
    return { tilesUrl: `/tiles/${dataset.id}/{z}/{x}/{y}.png`, minZoom: 12, maxZoom };
}

// 외부(예: DJI Terra) XYZ 타일 폴더 검사: {z}/{x}/{y}.png 구조에서 줌 범위 추출
export function inspectTilesDir(dir) {
    if (!dir || !fs.existsSync(dir)) return null;
    const zooms = fs.readdirSync(dir).filter((n) => /^\d{1,2}$/.test(n) && fs.statSync(path.join(dir, n)).isDirectory()).map(Number).sort((a, b) => a - b);
    if (!zooms.length) return null;
    const z = zooms[zooms.length - 1];
    const xs = fs.readdirSync(path.join(dir, String(z))).filter((n) => /^\d+$/.test(n));
    let ext = 'png';
    if (xs.length) {
        const files = fs.readdirSync(path.join(dir, String(z), xs[0]));
        const f = files.find((n) => /\.(png|jpg|jpeg|webp)$/i.test(n));
        if (f) ext = f.split('.').pop().toLowerCase();
    }
    return { minZoom: zooms[0], maxZoom: z, ext };
}

// 등록 직후 자동 처리: 메타 -> 미리보기 -> 타일
export function processRasterDataset(store, dataset, { tiles = true } = {}) {
    return runJob('dataset-process', { datasetId: dataset.id, siteId: dataset.siteId }, async (update) => {
        let ds = store.get('datasets', dataset.id);
        update({ progress: 2, logLine: '메타데이터 추출' });
        const meta = await extractRasterMeta(ds.sourcePath);
        ds = store.update('datasets', ds.id, { ...meta, status: 'processing' });
        broadcast('dataset', ds);
        // 외부 타일 폴더가 있으면 재생성 없이 그대로 서빙
        if (ds.tilesDir) {
            const info = inspectTilesDir(ds.tilesDir);
            if (info) {
                ds = store.update('datasets', ds.id, { tilesUrl: `/tiles/${ds.id}/{z}/{x}/{y}.${info.ext}`, minZoom: info.minZoom, maxZoom: info.maxZoom, tilesStatus: 'ready', tilesSource: 'external', status: 'ready' });
                broadcast('dataset', ds);
                update({ progress: 100, logLine: `외부 타일 z${info.minZoom}-${info.maxZoom} 연결` });
                return { datasetId: ds.id, tilesStatus: 'ready' };
            }
            update({ logLine: '외부 타일 폴더 구조를 인식하지 못해 직접 생성합니다' });
        }
        try {
            const preview = await buildPreview(ds, update);
            ds = store.update('datasets', ds.id, { ...preview });
            broadcast('dataset', ds);
        } catch (err) {
            update({ logLine: `미리보기 실패: ${err.message}` });
        }
        if (tiles && findGdal()) {
            try {
                ds = store.update('datasets', ds.id, { tilesStatus: 'running' });
                const t = await buildTiles(ds, update);
                ds = store.update('datasets', ds.id, { ...t, tilesStatus: 'ready' });
            } catch (err) {
                ds = store.update('datasets', ds.id, { tilesStatus: 'error', tilesError: err.message });
                update({ logLine: `타일 실패: ${err.message}` });
            }
        }
        ds = store.update('datasets', ds.id, { status: 'ready' });
        broadcast('dataset', ds);
        return { datasetId: ds.id, tilesStatus: ds.tilesStatus };
    });
}
