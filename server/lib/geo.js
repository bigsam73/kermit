// 지오메트리 유틸 (WGS84 경위도 기준)
const EARTH_R = 6378137;
const DEG = Math.PI / 180;

export function haversine(lon1, lat1, lon2, lat2) {
    const dLat = (lat2 - lat1) * DEG;
    const dLon = (lon2 - lon1) * DEG;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// 경위도 다각형(ring: [[lon,lat],...]) 면적(m2) - 구면 근사
export function ringAreaSqm(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let area = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[(i + 1) % n];
        area += (lon2 - lon1) * DEG * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
    }
    return Math.abs((area * EARTH_R * EARTH_R) / 2);
}

export function polygonAreaSqm(polygon) {
    if (!Array.isArray(polygon) || !polygon.length) return 0;
    const outer = ringAreaSqm(polygon[0]);
    const holes = polygon.slice(1).reduce((s, r) => s + ringAreaSqm(r), 0);
    return Math.max(0, outer - holes);
}

export function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

export function pointInPolygon(lon, lat, polygon) {
    if (!Array.isArray(polygon) || !polygon.length) return false;
    if (!pointInRing(lon, lat, polygon[0])) return false;
    for (const hole of polygon.slice(1)) if (pointInRing(lon, lat, hole)) return false;
    return true;
}

export function ringCentroid(ring) {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const [lon, lat] of ring) {
        x += lon;
        y += lat;
        n++;
    }
    return n ? [x / n, y / n] : [0, 0];
}

export function ringBounds(ring) {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lon, lat] of ring) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
    }
    return { west, south, east, north };
}

// 중심점 + 가로/세로(m) + 회전(deg)으로 직사각형 ring 생성
export function rectRing(lon, lat, widthM, heightM, rotationDeg = 0) {
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(lat * DEG);
    const rot = rotationDeg * DEG;
    const corners = [
        [-widthM / 2, -heightM / 2],
        [widthM / 2, -heightM / 2],
        [widthM / 2, heightM / 2],
        [-widthM / 2, heightM / 2],
    ];
    const ring = corners.map(([dx, dy]) => {
        const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
        const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
        return [lon + rx / mPerDegLon, lat + ry / mPerDegLat];
    });
    ring.push(ring[0]);
    return ring;
}

export function offsetLonLat(lon, lat, dxM, dyM) {
    return [lon + dxM / (111320 * Math.cos(lat * DEG)), lat + dyM / 111320];
}
