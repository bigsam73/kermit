// 건축물대장 기반 건물 정보 조회 (브이월드 건물통합정보 LT_C_BLDGINFO) → 필지별 층수·용도 등 요약
import { loadSettings } from './geocode.js';
import { pointInPolygon } from './geo.js';

// 건축물대장 주용도 코드
export const USAGE_NAMES = {
    '01000': '단독주택', '02000': '공동주택', '03000': '제1종근린생활', '04000': '제2종근린생활', '05000': '문화및집회', '06000': '종교',
    '07000': '판매', '08000': '운수', '09000': '의료', '10000': '교육연구', '11000': '노유자', '12000': '수련', '13000': '운동',
    '14000': '업무', '15000': '숙박', '16000': '위락', '17000': '공장', '18000': '창고', '19000': '위험물저장및처리', '20000': '자동차관련',
    '21000': '동물및식물관련', '22000': '자원순환관련', '23000': '교정및군사', '24000': '방송통신', '25000': '발전', '26000': '묘지관련',
    '27000': '관광휴게', '28000': '장례', '29000': '야영장',
};
// 주용도 → 시설 유형(지도 색상)
export const USAGE_CATEGORY = {
    '17000': 'factory', '18000': 'warehouse', '08000': 'warehouse', '14000': 'office', '03000': 'office', '04000': 'office', '10000': 'office',
    '25000': 'utility', '24000': 'utility', '19000': 'utility', '22000': 'treatment', '20000': 'utility',
};
const STRUCT_NAMES = { 10: '목구조', 11: '벽돌조', 21: '블록조', 22: '석조', 31: '철근콘크리트', 32: '프리캐스트콘크리트', 41: '일반철골', 42: '경량철골', 43: '철골철근콘크리트', 51: '조적조', 99: '기타' };

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

async function fetchBox(bbox, s) {
    const [w, so, e, n] = bbox;
    const out = [];
    for (let page = 1; page <= 5; page++) {
        const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_BLDGINFO&format=json&geometry=true&attribute=true&crs=EPSG:4326&size=1000&page=${page}&geomFilter=${encodeURIComponent(`BOX(${w},${so},${e},${n})`)}&key=${encodeURIComponent(s.vworldKey)}&domain=${encodeURIComponent(s.vworldDomain)}`;
        const j = await (await fetch(url)).json();
        const r = j?.response;
        if (r?.status === 'NOT_FOUND') break;
        if (r?.status !== 'OK') throw new Error(r?.error?.text || 'VWorld 건물정보 오류');
        out.push(...(r.result?.featureCollection?.features || []));
        if (page >= Number(r.page?.total || 1)) break;
    }
    return out;
}

const ringCentroid = (ring) => {
    let x = 0;
    let y = 0;
    const n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
};

// 필지 하나의 건물 요약 (필지 폴리곤 안에 중심이 있거나 꼭짓점의 절반 이상이 들어오는 건물)
export async function lookupParcelBuildings(parcel, s = loadSettings()) {
    if (!s.vworldKey) throw new Error('브이월드 키가 필요합니다');
    const poly = parcel.geometry?.coordinates;
    if (!poly?.[0]?.length) throw new Error('필지 경계가 없습니다');
    let w = 181; let so = 91; let e = -181; let n = -91;
    for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
    const feats = await fetchBox([w, so, e, n], s);
    const buildings = [];
    for (const f of feats) {
        const g = f.geometry;
        const polys = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : [];
        const p = f.properties || {};
        for (const bp of polys) {
            const ring = bp[0];
            if (!ring?.length) continue;
            const [cx, cy] = ringCentroid(ring);
            const inside = pointInPolygon(cx, cy, poly) || ring.filter(([x, y]) => pointInPolygon(x, y, poly)).length >= ring.length / 2;
            if (!inside) continue;
            const grnd = num(p.grnd_flr);
            const arch = num(p.archarea);
            if (!grnd && !arch) continue; // 층수·면적 정보가 없는 부속 도형은 제외
            const code = String(p.usability || '');
            buildings.push({
                name: p.bld_nm || null, dong: p.dong_nm || null,
                usageCode: code || null, usage: USAGE_NAMES[code] || null,
                floors: grnd, basement: num(p.ugrnd_flr), archAreaSqm: arch, totalAreaSqm: num(p.totalarea),
                heightM: num(p.height) || null, bcRat: num(p.bc_rat) || null, vlRat: num(p.vl_rat) || null,
                approvedAt: p.useapr_day || null, structure: STRUCT_NAMES[Number(p.strct_cd)] || (p.strct_cd ? `코드 ${p.strct_cd}` : null),
                ring: ring.map(([x, y]) => [Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7]),
            });
        }
    }
    buildings.sort((a, b) => (b.totalAreaSqm || b.archAreaSqm) - (a.totalAreaSqm || a.archAreaSqm));
    const kept = buildings.slice(0, 40);
    const main = kept[0] || null;
    const sum = (k) => Math.round(kept.reduce((t, b) => t + (b[k] || 0), 0) * 100) / 100;
    const dates = kept.map((b) => b.approvedAt).filter(Boolean).sort();
    return {
        bldCount: kept.length,
        buildings: kept,
        floors: kept.length ? Math.max(...kept.map((b) => b.floors)) : null,
        basementFloors: kept.length ? Math.max(...kept.map((b) => b.basement)) : null,
        usageCode: main?.usageCode || null,
        usageName: main?.usage || null,
        usageList: [...new Set(kept.map((b) => b.usage).filter(Boolean))],
        bldArchAreaSqm: sum('archAreaSqm'),
        bldTotalAreaSqm: sum('totalAreaSqm'),
        heightM: kept.length ? Math.max(...kept.map((b) => b.heightM || 0)) || null : null,
        approvedFirst: dates[0] || null,
        approvedLast: dates[dates.length - 1] || null,
        structure: main?.structure || null,
        bcRat: main?.bcRat || null,
        vlRat: main?.vlRat || null,
        bldFetchedAt: new Date().toISOString(),
    };
}
