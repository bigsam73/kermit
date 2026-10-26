// 열화상 정사영상 분석: 온도 통계 + 핫스팟(연결 성분) 추출 + 태양광 어레이 매칭
import { readRasterGrid, gridStats, makeToWgs84 } from './raster.js';
import { pointInPolygon } from './geo.js';

const SEVERITY_RULES = [
    { level: 'critical', deltaT: 30 },
    { level: 'high', deltaT: 20 },
    { level: 'medium', deltaT: 10 },
    { level: 'low', deltaT: 0 },
];

export function severityForDelta(deltaT) {
    return SEVERITY_RULES.find((r) => deltaT >= r.deltaT)?.level || 'low';
}

// 8비트 열화상(팔레트 인덱스)일 때 온도 환산 범위
function toTemperature(v, grid, options) {
    if (grid.isFloat || options.rawIsTemperature) return v;
    const lo = options.scaleMin ?? 0;
    const hi = options.scaleMax ?? 100;
    const maxRaw = grid.bits === 16 ? 65535 : 255;
    return lo + (v / maxRaw) * (hi - lo);
}

export async function analyzeThermal(file, options = {}) {
    const {
        panelArrays = [],
        deltaThreshold = 15, // PV: 어레이 중앙값 대비 상승 온도(°C)
        absoluteThreshold = null, // 절대 온도 임계값(°C). 지정 시 둘 중 높은 값을 사용
        minPixels = 3,
        maxDim = 1024,
    } = options;
    // PV 외 영역은 지붕·도로 등 자연 고온면이 많으므로 더 높은 ΔT를 적용 (기본 ΔT+20)
    const nonPvDelta = Number.isFinite(options.nonPvDeltaThreshold) ? options.nonPvDeltaThreshold : deltaThreshold + 20;
    const maxHotspots = Number(options.maxHotspots) || 300;

    const grid = await readRasterGrid(file, { maxDim });
    const { width, height, data, nodata, bounds } = grid;
    if (!bounds) throw new Error('래스터 경계(WGS84)를 알 수 없습니다. 좌표계가 정의된 GeoTIFF가 필요합니다.');

    const temps = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        temps[i] = !Number.isFinite(v) || (nodata !== null && v === nodata) ? NaN : toTemperature(v, grid, options);
    }
    const stats = gridStats({ data: temps, nodata: null });
    const background = stats.median;
    let threshold = background + nonPvDelta;
    if (Number.isFinite(absoluteThreshold)) threshold = Math.max(threshold, absoluteThreshold);

    // 픽셀 -> 경위도 (bounds는 WGS84 사각형이므로 선형 보간; 투영 CRS 원본도 bbox 변환 후 선형 근사)
    const toLonLat = (px, py) => [
        bounds.west + ((px + 0.5) / width) * (bounds.east - bounds.west),
        bounds.north - ((py + 0.5) / height) * (bounds.north - bounds.south),
    ];

    // PV 어레이 영역은 모듈 표면 온도(어레이별 중앙값)를 기준선으로 사용한다.
    // (IEC TS 62446-3: 정상 모듈 대비 상승 온도 ΔT로 이상 판정)
    const zone = new Int16Array(width * height).fill(-1);
    const zoneThreshold = new Float32Array(Math.max(1, panelArrays.length)).fill(background + deltaThreshold);
    const zoneBaseline = new Float32Array(Math.max(1, panelArrays.length)).fill(background);
    panelArrays.forEach((a, zi) => {
        const ring = a.geometry?.coordinates?.[0];
        if (!ring) return;
        const lons = ring.map((p) => p[0]);
        const lats = ring.map((p) => p[1]);
        const c0 = Math.max(0, Math.floor(((Math.min(...lons) - bounds.west) / (bounds.east - bounds.west)) * width));
        const c1 = Math.min(width - 1, Math.ceil(((Math.max(...lons) - bounds.west) / (bounds.east - bounds.west)) * width));
        const r0 = Math.max(0, Math.floor(((bounds.north - Math.max(...lats)) / (bounds.north - bounds.south)) * height));
        const r1 = Math.min(height - 1, Math.ceil(((bounds.north - Math.min(...lats)) / (bounds.north - bounds.south)) * height));
        const sample = [];
        for (let y = r0; y <= r1; y++) {
            for (let x = c0; x <= c1; x++) {
                const [lon, lat] = toLonLat(x, y);
                if (!pointInPolygon(lon, lat, a.geometry.coordinates)) continue;
                zone[y * width + x] = zi;
                const t = temps[y * width + x];
                if (Number.isFinite(t)) sample.push(t);
            }
        }
        if (sample.length >= 4) {
            sample.sort((p, q) => p - q);
            const med = sample[Math.floor(sample.length / 2)];
            zoneBaseline[zi] = med;
            zoneThreshold[zi] = Math.max(med + deltaThreshold, Number.isFinite(absoluteThreshold) ? absoluteThreshold : -Infinity);
        }
    });
    const isHot = (idx) => {
        const t = temps[idx];
        if (!(t >= -200)) return false;
        const z = zone[idx];
        return z >= 0 ? t >= zoneThreshold[z] : t >= threshold;
    };
    const pixelAreaSqm = (() => {
        const dLon = ((bounds.east - bounds.west) / width) * 111320 * Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180);
        const dLat = ((bounds.north - bounds.south) / height) * 111320;
        return Math.abs(dLon * dLat);
    })();

    // 연결 성분 탐색 (4-neighbour)
    const visited = new Uint8Array(width * height);
    const components = [];
    const stack = [];
    for (let i = 0; i < temps.length; i++) {
        if (visited[i] || !isHot(i)) continue;
        let minX = width; let maxX = -1; let minY = height; let maxY = -1;
        let count = 0; let sum = 0; let maxT = -Infinity; let maxIdx = i;
        stack.push(i);
        visited[i] = 1;
        while (stack.length) {
            const idx = stack.pop();
            const x = idx % width;
            const y = (idx - x) / width;
            count++;
            sum += temps[idx];
            if (temps[idx] > maxT) { maxT = temps[idx]; maxIdx = idx; }
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            const nb = [idx - 1, idx + 1, idx - width, idx + width];
            if (x === 0) nb[0] = -1;
            if (x === width - 1) nb[1] = -1;
            for (const n of nb) {
                if (n < 0 || n >= temps.length || visited[n]) continue;
                if (isHot(n)) { visited[n] = 1; stack.push(n); }
            }
        }
        if (count < minPixels) continue;
        const cx = maxIdx % width;
        const cy = (maxIdx - cx) / width;
        const [lon, lat] = toLonLat(cx, cy);
        const ring = [toLonLat(minX - 0.5, minY - 0.5), toLonLat(maxX + 0.5, minY - 0.5), toLonLat(maxX + 0.5, maxY + 0.5), toLonLat(minX - 0.5, maxY + 0.5)];
        ring.push(ring[0]);
        const zi = zone[maxIdx];
        const baseline = zi >= 0 ? zoneBaseline[zi] : background;
        const deltaT = maxT - baseline;
        const arrayHit = zi >= 0 ? panelArrays[zi] : panelArrays.find((a) => a.geometry?.coordinates && pointInPolygon(lon, lat, a.geometry.coordinates));
        components.push({
            lon, lat, maxT: round1(maxT), meanT: round1(sum / count), deltaT: round1(deltaT), baselineT: round1(baseline),
            category: arrayHit ? 'pv' : 'non-pv',
            pixels: count, areaSqm: round1(count * pixelAreaSqm),
            severity: severityForDelta(deltaT),
            arrayId: arrayHit?.id || null,
            arrayName: arrayHit?.name || null,
            facilityId: arrayHit?.facilityId || null,
            polygon: ring,
        });
    }
    components.sort((a, b) => b.maxT - a.maxT);

    return {
        stats: { min: round1(stats.min), max: round1(stats.max), mean: round1(stats.mean), std: round1(stats.std), median: round1(stats.median), pixels: stats.count },
        background: round1(background),
        threshold: round1(threshold),
        bounds,
        grid: { width, height, fullWidth: grid.fullWidth, fullHeight: grid.fullHeight, epsg: grid.epsg, isFloat: grid.isFloat },
        hotspots: components.slice(0, maxHotspots),
        hotspotCount: components.length,
        truncated: components.length > maxHotspots,
    };
}

// 클라이언트 오버레이용 다운샘플 온도 그리드 (Float32 -> base64)
export async function thermalGridPayload(file, options = {}) {
    const grid = await readRasterGrid(file, { maxDim: options.maxDim || 768 });
    const temps = new Float32Array(grid.data.length);
    for (let i = 0; i < grid.data.length; i++) {
        const v = grid.data[i];
        temps[i] = !Number.isFinite(v) || (grid.nodata !== null && v === grid.nodata) ? NaN : toTemperature(v, grid, options);
    }
    const stats = gridStats({ data: temps, nodata: null });
    return {
        width: grid.width, height: grid.height, bounds: grid.bounds, min: round1(stats.min), max: round1(stats.max), mean: round1(stats.mean), median: round1(stats.median),
        data: Buffer.from(temps.buffer).toString('base64'),
    };
}

function round1(v) {
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

export { makeToWgs84 };
