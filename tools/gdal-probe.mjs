// 사용: node tools/gdal-probe.mjs <file...>  — gdalinfo 핵심 메타(크기·밴드·타입·EPSG·WGS84 경계·통계) 요약
import { spawnSync } from 'node:child_process';
import { findGdal } from '../server/lib/gdal.js';

const g = findGdal();
if (!g) {
    console.error('GDAL not found');
    process.exit(1);
}
for (const f of process.argv.slice(2)) {
    const r = spawnSync(g.gdalinfo, ['-json', '-approx_stats', f], { encoding: 'utf8', maxBuffer: 50e6, env: g.env });
    try {
        const j = JSON.parse(r.stdout);
        const b = j.bands[0];
        const m = String(j.coordinateSystem?.wkt || '').match(/ID\["EPSG",(\d+)\]\]\s*$/);
        const ring = j.wgs84Extent?.coordinates?.[0] || [];
        const lons = ring.map((c) => c[0]);
        const lats = ring.map((c) => c[1]);
        console.log('###', f);
        console.log('  size', j.size.join('x'), 'bands', j.bands.length, 'type', b.type, 'nodata', b.noDataValue, 'color', b.colorInterpretation, 'epsg', m && m[1], 'gsd', Math.abs(j.geoTransform[1]).toFixed(3));
        console.log('  bounds W/S/E/N', Math.min(...lons).toFixed(5), Math.min(...lats).toFixed(5), Math.max(...lons).toFixed(5), Math.max(...lats).toFixed(5));
        console.log('  stats min/max/mean', b.minimum, b.maximum, b.mean, 'meta', JSON.stringify(b.metadata || {}).slice(0, 200));
    } catch (e) {
        console.log('###', f, 'ERR', e.message, (r.stderr || '').slice(0, 300));
    }
}
