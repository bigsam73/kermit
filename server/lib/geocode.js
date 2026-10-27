// 주소 지오코딩 (브이월드 → 카카오 → OSM Nominatim 순). 키가 없으면 Nominatim(무료, 초당 1건)만 사용한다.
// 브이월드 키가 있으면 지적도(연속지적도) 필지 경계 폴리곤까지 가져온다.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './datasets.js';
import { pointInRing } from './geo.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'geocode-settings.json');
const CACHE_FILE = path.join(DATA_DIR, 'geocode-cache.json');
const UA = 'PICT-INDUSTRIAL/1.0 geocoder';

export function loadSettings() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { /* none */ }
    return {
        vworldKey: s.vworldKey || process.env.VWORLD_KEY || '',
        vworldDomain: s.vworldDomain || process.env.VWORLD_DOMAIN || 'localhost',
        kakaoKey: s.kakaoKey || process.env.KAKAO_REST_KEY || '',
    };
}

export function saveSettings(patch) {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { /* none */ }
    for (const k of ['vworldKey', 'vworldDomain', 'kakaoKey']) if (patch[k] !== undefined) s[k] = String(patch[k]).trim();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

export function publicSettings() {
    const s = loadSettings();
    const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-3)}` : '');
    return { vworld: Boolean(s.vworldKey), vworldKey: mask(s.vworldKey), vworldDomain: s.vworldDomain, kakao: Boolean(s.kakaoKey), kakaoKey: mask(s.kakaoKey), providers: providerOrder(s) };
}

function providerOrder(s = loadSettings()) {
    return [s.vworldKey && 'vworld', s.kakaoKey && 'kakao', 'nominatim'].filter(Boolean);
}

let cache = null;
function cacheGet(key) {
    if (!cache) {
        try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
    }
    return cache[key] || null;
}
let cacheTimer = null;
function cacheSet(key, value) {
    if (!cache) cacheGet(key);
    cache[key] = value;
    if (cacheTimer) return;
    cacheTimer = setTimeout(() => {
        cacheTimer = null;
        try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch { /* ignore */ }
    }, 1500);
}

// 입력 주소의 시·군·구가 매칭 결과에 없으면 엉뚱한 지역으로 보정된 것이므로 거부
function regionOk(input, matched) {
    const toks = String(input).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((t) => /^[가-힣]{1,6}(시|군|구)$/.test(t));
    if (!toks.length) return true;
    return toks.some((t) => String(matched || '').includes(t));
}

export const normalizeAddress = (a) => String(a || '').replace(/\s+/g, ' ').replace(/[,;]+/g, ' ').trim();

async function getJson(url, { headers = {}, timeoutMs = 12000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko', ...headers }, signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

// ── 브이월드 ────────────────────────────────────────────
async function vworldPoint(address, s) {
    for (const type of ['parcel', 'road']) {
        const url = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&refine=false&simple=false&format=json&type=${type}&key=${encodeURIComponent(s.vworldKey)}&domain=${encodeURIComponent(s.vworldDomain)}&address=${encodeURIComponent(address)}`;
        const j = await getJson(url);
        const r = j?.response;
        if (r?.status === 'OK' && r.result?.point) {
            return { lon: Number(r.result.point.x), lat: Number(r.result.point.y), matched: r.refined?.text || address, accuracy: type === 'parcel' ? 'parcel' : 'road' };
        }
        if (r?.status === 'ERROR') throw new Error(r.error?.text || 'VWorld error');
    }
    return null;
}

// 연속지적도: 좌표가 속한 필지 폴리곤
async function vworldParcel(lon, lat, s) {
    const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN&format=json&geometry=true&attribute=true&crs=EPSG:4326&size=5&geomFilter=${encodeURIComponent(`POINT(${lon} ${lat})`)}&key=${encodeURIComponent(s.vworldKey)}&domain=${encodeURIComponent(s.vworldDomain)}`;
    const j = await getJson(url);
    const feats = j?.response?.result?.featureCollection?.features || [];
    for (const f of feats) {
        const g = f.geometry;
        if (!g) continue;
        const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
        const hit = polys.find((p) => pointInRing(lon, lat, p[0])) || polys[0];
        if (hit) return { polygon: hit, pnu: f.properties?.pnu, jibun: f.properties?.jibun, addr: f.properties?.addr };
    }
    return null;
}

// ── 카카오 ──────────────────────────────────────────────
async function kakaoPoint(address, s) {
    const j = await getJson(`https://dapi.kakao.com/v2/local/search/address.json?size=1&query=${encodeURIComponent(address)}`, { headers: { Authorization: `KakaoAK ${s.kakaoKey}` } });
    const d = j?.documents?.[0];
    if (!d) return null;
    return { lon: Number(d.x), lat: Number(d.y), matched: d.address_name, accuracy: d.address_type === 'ROAD_ADDR' || d.address_type === 'ROAD' ? 'road' : 'parcel' };
}

// ── OSM Nominatim (초당 1건 제한) ────────────────────────────
let nomChain = Promise.resolve();
let nomLast = 0;
function nominatimRaw(q) {
    const run = async () => {
        const wait = Math.max(0, nomLast + 1150 - Date.now());
        if (wait) await new Promise((r) => setTimeout(r, wait));
        nomLast = Date.now();
        const j = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&polygon_geojson=1&addressdetails=0&q=${encodeURIComponent(q)}`);
        return j?.[0] || null;
    };
    const p = nomChain.then(run, run);
    nomChain = p.catch(() => {});
    return p;
}

// 번지 없는 동/리 수준 질의용: 끝의 번지·산·건물명 제거
function stripLot(address) {
    return address.replace(/\([^)]*\)/g, '').replace(/\s+산?\s*\d+(-\d+)?(번지)?\s*(외.*)?$/u, '').replace(/\s+\d+(-\d+)?\s*(번지)?\s*$/u, '').trim();
}

async function nominatimPoint(address) {
    const cleaned = address.replace(/\([^)]*\)/g, '').trim();
    const tries = [{ q: cleaned, accuracy: 'parcel' }];
    const area = stripLot(cleaned);
    if (area && area !== cleaned) tries.push({ q: area, accuracy: 'area' });
    // OSM 은 번지 단위가 거의 없어 읍·면·동·리 수준으로 단계적으로 완화 (시도명은 표기가 달라 제외)
    const admin = area.split(' ').filter((t) => t && !/(특별시|광역시|특별자치시|특별자치도|도)$/.test(t));
    if (admin.length >= 2) {
        const alt = [admin.join(' '), admin.slice(0, -1).join(' '), `${admin[admin.length - 1]} ${admin[0]}`];
        for (const q of alt) if (q && !tries.some((t) => t.q === q)) tries.push({ q, accuracy: 'area' });
    }
    for (const t of tries) {
        const h = await nominatimRaw(t.q);
        if (!h) continue;
        const gj = h.geojson;
        const polygon = gj?.type === 'Polygon' ? gj.coordinates : gj?.type === 'MultiPolygon' ? gj.coordinates[0] : null;
        const isArea = t.accuracy === 'area' || ['administrative', 'boundary', 'place'].includes(h.category) && !['house', 'building'].includes(h.type);
        return { lon: Number(h.lon), lat: Number(h.lat), matched: h.display_name, accuracy: isArea ? 'area' : t.accuracy, polygon: !isArea && polygon && polygon[0]?.length >= 4 && polygon[0].length < 80 ? polygon : null };
    }
    return null;
}

// ── 공개 API ────────────────────────────────────────────
export async function geocodeAddress(rawAddress, { fresh = false } = {}) {
    const address = normalizeAddress(rawAddress);
    if (!address) return { ok: false, error: '주소가 비어 있습니다' };
    const s = loadSettings();
    const key = `${providerOrder(s).join('+')}|${address}`;
    if (!fresh) {
        const hit = cacheGet(key);
        if (hit) return { ...hit, cached: true };
    }
    const errors = [];
    for (const provider of providerOrder(s)) {
        try {
            let r = null;
            if (provider === 'vworld') r = await vworldPoint(address, s);
            else if (provider === 'kakao') r = await kakaoPoint(address, s);
            else r = await nominatimPoint(address);
            if (!r) continue;
            if (!regionOk(address, r.matched)) { errors.push(`${provider}: 다른 지역으로 매칭됨 (${r.matched})`); continue; }
            let polygon = r.polygon || null;
            let polygonSource = polygon ? 'osm' : null;
            let pnu;
            if (s.vworldKey && r.accuracy !== 'area') {
                try {
                    const p = await vworldParcel(r.lon, r.lat, s);
                    if (p) { polygon = p.polygon; polygonSource = 'cadastral'; pnu = p.pnu; }
                } catch (err) { errors.push(`vworld-parcel: ${err.message}`); }
            }
            const out = { ok: true, provider, lon: r.lon, lat: r.lat, matched: r.matched, accuracy: r.accuracy, polygon, polygonSource, pnu };
            cacheSet(key, out);
            return out;
        } catch (err) {
            errors.push(`${provider}: ${err.message}`);
        }
    }
    return { ok: false, error: errors.length ? errors.join(' / ') : '일치하는 주소를 찾지 못했습니다' };
}
