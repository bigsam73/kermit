// 래스터 읽기: GeoTIFF(geotiff.js) / AAIGrid(.asc) -> 다운샘플 그리드 + WGS84 경계
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';
import { fromFile } from 'geotiff';
import { gdalInfo, findGdal, run } from './gdal.js';

// 국내에서 자주 쓰는 좌표계 정의 (EPSG 코드 -> proj4 문자열)
const CRS_DEFS = {
    4326: '+proj=longlat +datum=WGS84 +no_defs',
    3857: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs',
    5179: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
    5181: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
    5185: '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    5186: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    5187: '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    5188: '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
};

function projDefForEpsg(code) {
    if (CRS_DEFS[code]) return CRS_DEFS[code];
    // WGS84 UTM North 32601-32660, South 32701-32760
    if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
    if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
    return null;
}

export function toWgs84Bounds(bbox, epsg) {
    // bbox: [minX, minY, maxX, maxY] in source CRS
    if (!epsg || epsg === 4326) return { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] };
    const def = projDefForEpsg(epsg);
    if (!def) return null;
    const corners = [
        [bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]],
    ].map(([x, y]) => proj4(def, CRS_DEFS[4326], [x, y]));
    const lons = corners.map((c) => c[0]);
    const lats = corners.map((c) => c[1]);
    return { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
}

export function makeToWgs84(epsg) {
    if (!epsg || epsg === 4326) return (x, y) => [x, y];
    const def = projDefForEpsg(epsg);
    if (!def) return null;
    return (x, y) => proj4(def, CRS_DEFS[4326], [x, y]);
}

function parseAsc(file) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const header = {};
    let i = 0;
    for (; i < lines.length; i++) {
        const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/);
        if (!m) break;
        header[m[1].toLowerCase()] = Number(m[2]);
    }
    const width = header.ncols;
    const height = header.nrows;
    const cell = header.cellsize;
    const nodata = header.nodata_value ?? -9999;
    const x0 = header.xllcorner ?? header.xllcenter - cell / 2;
    const y0 = header.yllcorner ?? header.yllcenter - cell / 2;
    const data = new Float32Array(width * height);
    let k = 0;
    for (; i < lines.length && k < data.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (!parts[0]) continue;
        for (const p of parts) data[k++] = Number(p);
    }
    return { width, height, data, nodata, bbox: [x0, y0, x0 + width * cell, y0 + height * cell], epsg: 4326 };
}

// 대용량 GeoTIFF는 GDAL로 축소본(캐시)을 먼저 만들어 읽는다 (geotiff.js 전체 읽기 회피)
const ANALYSIS_CACHE_DIR = path.resolve(process.env.INDUSTRIAL_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data'), 'analysis');
async function downsampledCopy(file, maxDim, band) {
    const g = findGdal();
    if (!g) return null;
    try {
        const st = fs.statSync(file);
        if (st.size < 40 * 1024 * 1024) return null; // 40MB 미만은 직접 읽기
        fs.mkdirSync(ANALYSIS_CACHE_DIR, { recursive: true });
        const key = createHash('md5').update(`${file}|${st.size}|${st.mtimeMs}|${maxDim}|${band}`).digest('hex').slice(0, 16);
        const out = path.join(ANALYSIS_CACHE_DIR, `${key}.tif`);
        if (!fs.existsSync(out)) {
            await run(g.gdal_translate, ['-of', 'GTiff', '-b', String(band + 1), '-outsize', String(maxDim), '0', '-r', 'average', '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', file, out]);
        }
        return out;
    } catch (err) {
        console.warn('[raster] downsample cache failed:', err.message);
        return null;
    }
}

// GeoTIFF/ASC 파일을 읽어 최대 maxDim 크기로 리샘플링한 단일 밴드 그리드를 돌려준다.
export async function readRasterGrid(file, { maxDim = 1024, band = 0 } = {}) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.asc') {
        const asc = parseAsc(file);
        return downsample(asc, maxDim);
    }
    const cached = await downsampledCopy(file, maxDim, band);
    if (cached) {
        file = cached;
        band = 0;
    }
    const tiff = await fromFile(file);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));
    const keys = image.getGeoKeys() || {};
    let epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || null;
    let bbox = null;
    try {
        bbox = image.getBoundingBox();
    } catch {
        bbox = null;
    }
    const nodataRaw = image.getGDALNoData();
    const nodata = nodataRaw === null || nodataRaw === undefined ? null : Number(nodataRaw);
    const samples = image.getSamplesPerPixel();
    const rasters = await image.readRasters({ width: outW, height: outH, samples: [Math.min(band, samples - 1)], resampleMethod: 'bilinear' });
    const data = Float32Array.from(rasters[0]);
    const bits = image.getBitsPerSample?.()?.[0] ?? null;
    const sampleFormat = image.fileDirectory?.SampleFormat?.[0] ?? 1;
    let bounds = bbox ? toWgs84Bounds(bbox, epsg) : null;
    if (!bounds) {
        // GDAL fallback: wgs84Extent
        try {
            const info = await gdalInfo(file);
            const ring = info?.wgs84Extent?.coordinates?.[0];
            if (ring) {
                const lons = ring.map((c) => c[0]);
                const lats = ring.map((c) => c[1]);
                bounds = { west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) };
            }
            if (!epsg) {
                const m = String(info?.coordinateSystem?.wkt || '').match(/ID\["EPSG",(\d+)\]\]$/);
                if (m) epsg = Number(m[1]);
            }
        } catch {
            bounds = null;
        }
    }
    return {
        width: outW, height: outH, fullWidth: width, fullHeight: height, data, nodata, bbox, epsg, bounds, samples,
        bits, sampleFormat, isFloat: sampleFormat === 3,
    };
}

function downsample(src, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
    if (scale >= 1) return { ...src, fullWidth: src.width, fullHeight: src.height, bounds: toWgs84Bounds(src.bbox, src.epsg), samples: 1, isFloat: true };
    const outW = Math.round(src.width * scale);
    const outH = Math.round(src.height * scale);
    const out = new Float32Array(outW * outH);
    for (let y = 0; y < outH; y++) {
        const sy = Math.min(src.height - 1, Math.floor(y / scale));
        for (let x = 0; x < outW; x++) {
            const sx = Math.min(src.width - 1, Math.floor(x / scale));
            out[y * outW + x] = src.data[sy * src.width + sx];
        }
    }
    return { width: outW, height: outH, fullWidth: src.width, fullHeight: src.height, data: out, nodata: src.nodata, bbox: src.bbox, epsg: src.epsg, bounds: toWgs84Bounds(src.bbox, src.epsg), samples: 1, isFloat: true };
}

export function gridStats(grid) {
    const { data, nodata } = grid;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    const sample = [];
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (!Number.isFinite(v) || (nodata !== null && v === nodata)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        sumSq += v * v;
        n++;
        if (i % 7 === 0) sample.push(v);
    }
    if (!n) return { min: 0, max: 0, mean: 0, std: 0, median: 0, count: 0 };
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    sample.sort((a, b) => a - b);
    const median = sample.length ? sample[Math.floor(sample.length / 2)] : mean;
    return { min, max, mean, std, median, count: n };
}
