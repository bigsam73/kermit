// 도면(SHP / DXF / GeoJSON / KML / GPKG) → WGS84 GeoJSON 변환 (GDAL ogr2ogr)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import proj4 from 'proj4';
import { findGdal, run } from './gdal.js';

// 국내 도면에서 흔한 좌표계 후보 (자동 감지용)
const TM = (lon0, y0, ellps = 'GRS80', extra = '') => `+proj=tmerc +lat_0=38 +lon_0=${lon0} +k=1 +x_0=200000 +y_0=${y0} +ellps=${ellps} +units=m +no_defs ${extra}`;
const BESSEL = '+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
export const CRS_CANDIDATES = [
    { epsg: 5186, label: 'Korea 2000 중부원점(2010)', def: TM(127, 600000) },
    { epsg: 5185, label: 'Korea 2000 서부원점(2010)', def: TM(125, 600000) },
    { epsg: 5187, label: 'Korea 2000 동부원점(2010)', def: TM(129, 600000) },
    { epsg: 5188, label: 'Korea 2000 동해원점(2010)', def: TM(131, 600000) },
    { epsg: 5179, label: 'UTM-K (Korea 2000)', def: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs' },
    { epsg: 5181, label: 'Korea 2000 중부원점', def: TM(127, 500000) },
    { epsg: 5180, label: 'Korea 2000 서부원점', def: TM(125, 500000) },
    { epsg: 5182, label: 'Korea 2000 동부원점', def: TM(129, 500000) },
    { epsg: 5174, label: 'Korean 1985 중부원점(구 지적)', def: TM(127.0028902777778, 500000, 'bessel', BESSEL) },
    { epsg: 5173, label: 'Korean 1985 서부원점(구 지적)', def: TM(125.0028902777778, 500000, 'bessel', BESSEL) },
    { epsg: 5175, label: 'Korean 1985 동부원점(구 지적)', def: TM(129.0028902777778, 500000, 'bessel', BESSEL) },
    { epsg: 32652, label: 'WGS84 / UTM 52N', def: '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs' },
    { epsg: 32651, label: 'WGS84 / UTM 51N', def: '+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs' },
];

const inKorea = (lon, lat) => lon > 123.5 && lon < 132.5 && lat > 32.5 && lat < 39.5;

function ogr() {
    const g = findGdal();
    if (!g) throw new Error('GDAL을 찾을 수 없습니다 (QGIS 설치 필요)');
    const exe = process.platform === 'win32' ? '.exe' : '';
    return { ...g, ogr2ogr: path.join(g.dir, `ogr2ogr${exe}`), ogrinfo: path.join(g.dir, `ogrinfo${exe}`) };
}

// 업로드 파일 목록에서 GDAL 입력 경로(/vsizip 포함)와 종류를 결정
export function resolveSource(files) {
    const by = (re) => files.find((f) => re.test(f.name));
    const zip = by(/\.zip$/i);
    if (zip) {
        const list = spawnSync('tar', ['-tf', zip.path], { encoding: 'buffer' });
        const names = list.status === 0 ? list.stdout.toString('latin1').split(/\r?\n/).filter(Boolean) : [];
        const inner = names.find((n) => /\.(shp|dxf|geojson|json|kml|gpkg)$/i.test(n));
        const kind = inner ? inner.split('.').pop().toLowerCase() : 'shp';
        return { path: `/vsizip/${zip.path.replace(/\\/g, '/')}`, kind: kind === 'json' ? 'geojson' : kind, hasCpg: names.some((n) => /\.cpg$/i.test(n)) };
    }
    const main = by(/\.(shp|dxf|geojson|json|kml|gpkg)$/i);
    if (!main) throw new Error('SHP(.shp+.dbf+.shx+.prj 또는 .zip), DXF, GeoJSON, KML, GPKG 파일을 올려 주세요');
    const kind = main.name.split('.').pop().toLowerCase();
    if (kind === 'shp') {
        const base = main.path.replace(/\.shp$/i, '').toLowerCase();
        const has = (ext) => files.some((f) => f.path.toLowerCase() === `${base}${ext}`);
        if (!has('.dbf') || !has('.shx')) throw new Error('SHP는 .shp 와 함께 .dbf, .shx(권장 .prj)도 같이 올려야 합니다 (또는 zip 하나로)');
        return { path: main.path, kind, hasCpg: has('.cpg') };
    }
    return { path: main.path, kind: kind === 'json' ? 'geojson' : kind, hasCpg: false };
}

export async function inspectSource(src, env) {
    const g = ogr();
    const { out } = await run(g.ogrinfo, ['-json', '-so', '-al', src.path], { env });
    const info = JSON.parse(out);
    return (info.layers || []).map((l) => {
        const gf = l.geometryFields?.[0] || {};
        return { name: l.name, featureCount: l.featureCount, extent: gf.extent || null, wkt: gf.coordinateSystem?.wkt || null, epsg: gf.coordinateSystem?.projjson?.id?.code || null };
    });
}

function extentCorners(e) {
    const [x1, y1, x2, y2] = e;
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [(x1 + x2) / 2, (y1 + y2) / 2]];
}

// 좌표계 자동 판별: 범위가 이미 경위도면 4326, 아니면 후보 중 단지 중심에 가장 가까운 것
export function detectCrs(extent, near) {
    if (!extent) return null;
    const [x1, y1, x2, y2] = extent;
    if (inKorea(x1, y1) && inKorea(x2, y2)) return { epsg: 4326, label: 'WGS84 경위도', distKm: 0 };
    let best = null;
    for (const c of CRS_CANDIDATES) {
        try {
            const pts = extentCorners(extent).map((p) => proj4(c.def, 'EPSG:4326', p));
            if (!pts.every(([lon, lat]) => inKorea(lon, lat))) continue;
            const [clon, clat] = pts[4];
            const d = near ? Math.hypot((clon - near.lon) * Math.cos((near.lat * Math.PI) / 180), clat - near.lat) * 111 : 0;
            if (!best || d < best.distKm) best = { ...c, distKm: d };
        } catch { /* skip */ }
    }
    return best;
}

function parseStyle(style) {
    if (!style) return {};
    const out = {};
    const pen = /PEN\(([^)]*)\)/.exec(style)?.[1];
    const brush = /BRUSH\(([^)]*)\)/.exec(style)?.[1];
    const label = /LABEL\(([^)]*)\)/.exec(style)?.[1];
    const col = (s) => /c:(#[0-9a-fA-F]{6})/.exec(s || '')?.[1];
    out.color = col(pen) || col(brush) || col(label);
    const t = /t:"((?:[^"\\]|\\.)*)"/.exec(label || '')?.[1];
    if (t) out.text = t.replace(/\\n/g, ' ');
    return out;
}

// 변환 본체: 결과 GeoJSON 파일을 outFile 로 쓰고 요약 반환
export async function convertToGeoJson(files, outFile, { srcEpsg = 'auto', encoding = 'auto', near = null } = {}) {
    const g = ogr();
    const src = resolveSource(files);
    const env = { ...g.env };
    if (src.kind === 'shp') {
        const enc = encoding === 'auto' ? (src.hasCpg ? null : 'CP949') : encoding;
        if (enc) env.SHAPE_ENCODING = enc;
    }
    if (src.kind === 'dxf' && encoding !== 'auto') env.DXF_ENCODING = encoding;
    const layers = await inspectSource(src, env);
    if (!layers.length) throw new Error('읽을 수 있는 레이어가 없습니다');
    const ext = layers.map((l) => l.extent).filter(Boolean);
    const extent = ext.length ? [Math.min(...ext.map((e) => e[0])), Math.min(...ext.map((e) => e[1])), Math.max(...ext.map((e) => e[2])), Math.max(...ext.map((e) => e[3]))] : null;

    const args = ['-f', 'GeoJSON', outFile, src.path, '-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=7', '-skipfailures', '-dim', 'XY', '-nlt', 'PROMOTE_TO_MULTI'];
    let crs;
    const hasCrs = layers.some((l) => l.wkt);
    if (srcEpsg && srcEpsg !== 'auto') {
        args.push('-s_srs', `EPSG:${srcEpsg}`);
        crs = { source: 'user', epsg: Number(srcEpsg), label: `지정 EPSG:${srcEpsg}` };
    } else if (!hasCrs) {
        const d = detectCrs(extent, near);
        if (!d) throw new Error('좌표계를 알 수 없고 자동 판별에도 실패했습니다. 좌표계(EPSG)를 직접 선택해 주세요');
        args.push('-s_srs', `EPSG:${d.epsg}`);
        crs = { source: 'auto', epsg: d.epsg, label: `자동 판별 EPSG:${d.epsg} ${d.label}`, distKm: Math.round(d.distKm * 10) / 10 };
    } else {
        const m = layers[0].epsg;
        crs = { source: 'file', epsg: m || undefined, label: m ? `파일 내장 EPSG:${m}` : '파일 내장 좌표계(.prj)' };
    }
    if (src.kind === 'dxf') {
        // 스타일(색상)·문자 내용 보존을 위해 OGR_STYLE 을 함께 추출
        const layer = layers.find((l) => l.name === 'entities') || layers[0];
        args.push('-dialect', 'OGRSQL', '-sql', `SELECT *, OGR_STYLE FROM ${layer.name}`);
    }
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    await run(g.ogr2ogr, args, { env });

    const gj = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    const feats = (gj.features || []).filter((f) => f.geometry);
    const layerCounts = {};
    const geomTypes = {};
    const scan = (c, cb) => {
        if (typeof c[0] === 'number') cb(c);
        else c.forEach((x) => scan(x, cb));
    };
    let west = 181; let south = 91; let east = -181; let north = -91;
    const fieldCounts = {};
    for (const f of feats) {
        const p = f.properties || (f.properties = {});
        const st = parseStyle(p.OGR_STYLE);
        delete p.OGR_STYLE;
        if (st.color) p._c = st.color;
        if (st.text && !p.Text) p.Text = st.text;
        for (const k of Object.keys(p)) if (!k.startsWith("_")) fieldCounts[k] = (fieldCounts[k] || 0) + 1;
        const lyr = p.Layer ?? p.layer ?? '0';
        layerCounts[lyr] = (layerCounts[lyr] || 0) + 1;
        geomTypes[f.geometry.type] = (geomTypes[f.geometry.type] || 0) + 1;
        scan(f.geometry.coordinates, ([lon, lat]) => {
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
        });
    }
    if (!feats.length) throw new Error('변환된 도형이 없습니다 (빈 파일이거나 지원하지 않는 엔티티)');
    gj.features = feats;
    fs.writeFileSync(outFile, JSON.stringify(gj));
    if (!inKorea((west + east) / 2, (south + north) / 2)) {
        throw new Error(`변환 결과가 국내 범위를 벗어났습니다 (중심 ${((west + east) / 2).toFixed(4)}, ${((south + north) / 2).toFixed(4)}). 좌표계(EPSG)를 직접 선택해 주세요`);
    }
    return { kind: src.kind, featureCount: feats.length, bounds: { west, south, east, north }, layers: layerCounts, geomTypes, fields: Object.keys(fieldCounts).slice(0, 40), crs, sizeBytes: fs.statSync(outFile).size };
}
