// GDAL 연동: QGIS에 번들된 GDAL(gdalinfo / gdal_translate / gdal raster tile)을 찾아 실행한다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CANDIDATE_DIRS = [
    process.env.GDAL_BIN,
    'C:\\Program Files\\QGIS 4.0.2\\bin',
    'C:\\Program Files\\QGIS 3.40.13\\bin',
    'C:\\Program Files\\QGIS 3.38.2\\bin',
    'C:\\OSGeo4W\\bin',
    '/usr/bin',
].filter(Boolean);

let resolved = null;

export function findGdal() {
    if (resolved) return resolved;
    const exe = process.platform === 'win32' ? '.exe' : '';
    for (const dir of CANDIDATE_DIRS) {
        const info = path.join(dir, `gdalinfo${exe}`);
        if (!fs.existsSync(info)) continue;
        const root = path.resolve(dir, '..');
        const gdalData = [
            path.join(root, 'apps', 'gdal', 'share', 'gdal'),
            path.join(root, 'share', 'gdal'),
        ].find((p) => fs.existsSync(p));
        const projLib = [
            path.join(root, 'share', 'proj'),
            path.join(root, 'apps', 'proj', 'share', 'proj'),
        ].find((p) => fs.existsSync(p));
        resolved = {
            dir,
            gdalinfo: info,
            gdal_translate: path.join(dir, `gdal_translate${exe}`),
            gdal: path.join(dir, `gdal${exe}`),
            gdalwarp: path.join(dir, `gdalwarp${exe}`),
            env: {
                ...process.env,
                GDAL_DATA: gdalData || '',
                PROJ_LIB: projLib || '',
                PROJ_DATA: projLib || '',
                PATH: `${dir}${path.delimiter}${process.env.PATH}`,
            },
        };
        return resolved;
    }
    return null;
}

export function run(exe, args, { cwd, onProgress } = {}) {
    const g = findGdal();
    return new Promise((resolve, reject) => {
        const child = spawn(exe, args, { cwd, env: g?.env || process.env, windowsHide: true });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => {
            out += d;
            onProgress?.(String(d));
        });
        child.stderr.on('data', (d) => {
            err += d;
            onProgress?.(String(d));
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve({ out, err });
            else reject(new Error(`${path.basename(exe)} exit ${code}: ${err.slice(-400)}`));
        });
    });
}

export async function gdalInfo(file) {
    const g = findGdal();
    if (!g) return null;
    const { out } = await run(g.gdalinfo, ['-json', file]);
    return JSON.parse(out);
}

// 빠른 미리보기 PNG (최대 maxSize px) 생성
export async function makePreview(file, outPng, maxSize = 2048, extraArgs = []) {
    const g = findGdal();
    if (!g) throw new Error('GDAL not available');
    await run(g.gdal_translate, ['-of', 'PNG', '-outsize', String(maxSize), '0', '-r', 'average', ...extraArgs, file, outPng]);
    return outPng;
}

// WGS84로 재투영한 사본 생성 (미리보기 오버레이의 사각형 정합용)
export async function warpToWgs84(file, outTif, maxSize = 2048) {
    const g = findGdal();
    if (!g) throw new Error('GDAL not available');
    await run(g.gdalwarp, ['-t_srs', 'EPSG:4326', '-r', 'bilinear', '-ts', String(maxSize), '0', '-overwrite', file, outTif]);
    return outTif;
}

// XYZ 타일 생성 (WebMercatorQuad). gdal raster tile (GDAL >= 3.11)
export async function makeTiles(file, outDir, { minZoom = 12, maxZoom = 19, onProgress } = {}) {
    const g = findGdal();
    if (!g || !fs.existsSync(g.gdal)) throw new Error('gdal CLI not available');
    fs.mkdirSync(outDir, { recursive: true });
    await run(g.gdal, [
        'raster', 'tile', '-i', file, '-o', outDir,
        '--tiling-scheme', 'WebMercatorQuad',
        '--min-zoom', String(minZoom), '--max-zoom', String(maxZoom),
        '-f', 'PNG', '--convention', 'xyz', '--resampling', 'bilinear',
    ], { onProgress });
    return outDir;
}

// AAIGrid(.asc) -> GeoTIFF 변환 (합성 열화상 생성용)
export async function ascToGeoTiff(ascFile, outTif) {
    const g = findGdal();
    if (!g) throw new Error('GDAL not available');
    await run(g.gdal_translate, ['-of', 'GTiff', '-a_srs', 'EPSG:4326', '-co', 'COMPRESS=DEFLATE', ascFile, outTif]);
    return outTif;
}

export function gdalStatus() {
    const g = findGdal();
    return g ? { available: true, dir: g.dir, tileCli: fs.existsSync(g.gdal) } : { available: false };
}
