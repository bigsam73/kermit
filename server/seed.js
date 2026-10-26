// 데모 시드 데이터: 산업단지 3곳(동해 북평, 춘천 후평 3D 실증, 강촌 실증 테스트베드)
// 실제 보유 데이터(춘천 3D Tiles, 강촌 정사영상, 열화상 사진 폴더)를 데이터셋으로 등록하고,
// 북평 단지에는 합성 열화상 GeoTIFF를 생성해 핫스팟 분석까지 수행한다.
import fs from 'node:fs';
import path from 'node:path';
import { rectRing, offsetLonLat, polygonAreaSqm, ringCentroid, pointInPolygon } from './lib/geo.js';
import { SYNTH_DIR } from './lib/datasets.js';
import { run, findGdal } from './lib/gdal.js';

const LOCAL_ASSETS = {
    chuncheonTileset: 'D:\\20T_01\\itwin\\20241112\\Productions\\chuncheon_03_cesium\\Scene\\chuncheon_03_cesium.json',
    chuncheonTileset2: 'D:\\20T_01\\itwin\\20241112\\Productions\\Production_1_cesium\\Scene\\Production_1_cesium.json',
    gangchonOrtho: 'C:\\Users\\sunny\\Downloads\\-2026-8-15-orthophoto.tif',
    gangchonVari: 'C:\\Users\\sunny\\Downloads\\-2026-8-15-orthophoto-VARI.tif',
    thermalPhotoDir: 'C:\\Users\\sunny\\Downloads\\ir',
};

// ECEF -> 경위도 (3D Tiles 루트 구체 중심으로 사이트 위치 산출)
function ecefToLonLat([x, y, z]) {
    const a = 6378137;
    const e2 = 6.69437999014e-3;
    const lon = Math.atan2(y, x);
    const p = Math.sqrt(x * x + y * y);
    let lat = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 5; i++) {
        const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        lat = Math.atan2(z + e2 * n * Math.sin(lat), p);
    }
    return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

function tilesetCenter(file) {
    try {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        const bv = json?.root?.boundingVolume || {};
        if (bv.sphere) {
            const [lon, lat] = ecefToLonLat(bv.sphere.slice(0, 3));
            return { lon, lat, radius: bv.sphere[3] };
        }
        if (bv.box) {
            const [lon, lat] = ecefToLonLat(bv.box.slice(0, 3));
            const half = [3, 7, 11].map((i) => Math.hypot(bv.box[i], bv.box[i + 1], bv.box[i + 2]));
            return { lon, lat, radius: Math.hypot(...half) };
        }
    } catch {
        /* missing */
    }
    return null;
}

// DJI Terra 프로젝트(정사영상/열화상/3D) 실측 데이터
const TERRA_BASE = 'E:\\terra backup\\PCGSPRO_1731413002\\lalabas@naver.com';
const TERRA_SITES = [
    {
        id: 'site-donghae', code: 'DH', name: '동해산업단지 (실측 2026-09-16)', region: '강원 동해시 북평동', type: 'national', areaHa: 180, companies: 48, established: 1979,
        description: 'DJI Terra 실측: RGB 정사영상 2.6 cm, 열화상 정사영상 11 cm(Float32 °C), DSM, 3D Tiles(b3dm), 포인트클라우드. 시설·PV 폴리곤은 태양광/시설 메뉴의 "지도에서 그리기"로 등록하세요.',
        bounds: { west: 129.13182, south: 37.46983, east: 129.14689, north: 37.485 }, cameraHeight: 2300, pvTargetKwp: 10000, capturedAt: '2026-09-16',
        ortho: { path: `${TERRA_BASE}\\0916_동해산업단지\\map\\result.tif`, tilesDir: `${TERRA_BASE}\\0916_동해산업단지\\map`, name: '동해산단 RGB 정사영상 2.6 cm (2026-09-16)' },
        orthoThermalFlight: { path: `${TERRA_BASE}\\동해산업단지 열화상\\map\\result.tif`, tilesDir: `${TERRA_BASE}\\동해산업단지 열화상\\map`, name: '동해산단 RGB 정사영상 7.5 cm (열화상 비행 동시촬영)' },
        thermalDir: `${TERRA_BASE}\\동해산업단지 열화상\\map\\infrared_map`,
        dsm: `${TERRA_BASE}\\0916_동해산업단지\\map\\dsm.tif`,
        b3dm: `${TERRA_BASE}\\0916_동해산업단지\\models\\pc\\0\\terra_b3dms\\tileset.json`,
        pnts: `${TERRA_BASE}\\0916_동해산업단지\\models\\pc\\0\\terra_pnts\\tileset.json`,
    },
    {
        id: 'site-wonju', code: 'WJ', name: '원주 단계산업단지 (실측 2026-09-17)', region: '강원 원주시', type: 'general', areaHa: 230, companies: 60, established: 1990,
        description: 'DJI Terra 실측: RGB 정사영상 7.4 cm(지정 경로, 열화상 동일 비행) + 2.5 cm 보조, 열화상 정사영상 11 cm(Float32 °C), DSM, 3D Tiles(b3dm), 포인트클라우드. 시설·PV 폴리곤은 "지도에서 그리기"로 등록하세요.',
        bounds: { west: 127.79371, south: 37.28661, east: 127.81062, north: 37.30577 }, cameraHeight: 2600, pvTargetKwp: 8000, capturedAt: '2026-09-17',
        ortho: { path: `${TERRA_BASE}\\0917_원주단계산업단지\\map\\result.tif`, tilesDir: `${TERRA_BASE}\\0917_원주단계산업단지\\map`, name: '원주 단계산단 RGB 정사영상 2.5 cm (0917 프로젝트, 고해상도)' },
        orthoPrimary: 'irFlight', // 사용자 지정: 원주 정사영상 = 원주단계산업단지_열화상\map (열화상과 동일 비행)
        orthoThermalFlight: { path: `${TERRA_BASE}\\원주단계산업단지_열화상\\map\\result.tif`, tilesDir: `${TERRA_BASE}\\원주단계산업단지_열화상\\map`, name: '원주 단계산단 RGB 정사영상 7.4 cm (2026-09-17, 지정 경로)' },
        thermalDir: `${TERRA_BASE}\\원주단계산업단지_열화상\\map\\infrared_map`,
        dsm: `${TERRA_BASE}\\0917_원주단계산업단지\\map\\dsm.tif`,
        b3dm: `${TERRA_BASE}\\0917_원주단계산업단지\\models\\pc\\0\\terra_b3dms\\tileset.json`,
        pnts: `${TERRA_BASE}\\0917_원주단계산업단지\\models\\pc\\0\\terra_pnts\\tileset.json`,
    },
];

function boundsRing(b) {
    return [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
}

// Terra 실측 단지의 데이터셋 목록 생성 (존재하는 파일만)
function terraDatasets(site, now) {
    const out = [];
    const sid = site.id.replace('site-', '');
    const push = (row) => out.push({ createdAt: now, updatedAt: now, siteId: site.id, source: 'drone', platform: 'DJI Terra', capturedAt: site.capturedAt, ...row });
    if (fs.existsSync(site.ortho.path)) push({ id: `ds-${sid}-ortho`, name: site.ortho.name, type: 'orthophoto', sourcePath: site.ortho.path, tilesDir: site.ortho.tilesDir, status: 'registered', tilesStatus: 'none', visibleByDefault: site.orthoPrimary !== 'irFlight' });
    if (fs.existsSync(site.orthoThermalFlight.path)) push({ id: `ds-${sid}-ortho-ir-flight`, name: site.orthoThermalFlight.name, type: 'orthophoto', sourcePath: site.orthoThermalFlight.path, tilesDir: site.orthoThermalFlight.tilesDir, status: 'registered', tilesStatus: 'none', visibleByDefault: site.orthoPrimary === 'irFlight' });
    if (fs.existsSync(site.thermalDir)) {
        const tifs = fs.readdirSync(site.thermalDir).filter((n) => /^result_Infrared_\d+_[\d.]+\.tif$/i.test(n)).sort();
        tifs.forEach((n, i) => {
            const em = n.match(/_([\d.]+)\.tif$/i)?.[1];
            const base = path.join(site.thermalDir, n.replace(/\.tif$/i, ''));
            push({ id: `ds-${sid}-thermal${i === 0 ? '' : `-e${String(em).replace('.', '')}`}`, name: `${site.name.split(' (')[0]} 열화상 정사영상 11 cm (방사율 ${em})`, type: 'thermal', sourcePath: path.join(site.thermalDir, n), tilesDir: fs.existsSync(base) ? base : undefined, rawIsTemperature: true, emissivity: Number(em), isPrimaryThermal: i === 0, status: 'registered', tilesStatus: 'none', visibleByDefault: i === 0 });
        });
    }
    if (fs.existsSync(site.dsm)) push({ id: `ds-${sid}-dsm`, name: `${site.name.split(' (')[0]} DSM 5 cm`, type: 'dsm', sourcePath: site.dsm, status: 'registered', tilesStatus: 'none', autoProcess: false, visibleByDefault: false });
    if (fs.existsSync(site.b3dm)) push({ id: `ds-${sid}-3dtiles`, name: `${site.name.split(' (')[0]} 실측 3D Tiles (Terra b3dm)`, type: '3dtiles', sourcePath: site.b3dm, tilesetUrl: `/3dtiles/ds-${sid}-3dtiles/tileset.json`, center: tilesetCenter(site.b3dm), status: 'ready', visibleByDefault: true });
    if (fs.existsSync(site.pnts)) push({ id: `ds-${sid}-pnts`, name: `${site.name.split(' (')[0]} 포인트클라우드 (Terra pnts)`, type: 'pointcloud', sourcePath: site.pnts, tilesetUrl: `/3dtiles/ds-${sid}-pnts/tileset.json`, center: tilesetCenter(site.pnts), status: 'ready', visibleByDefault: false });
    return out;
}

let seedCounter = 0;
function sid(prefix) {
    seedCounter += 1;
    return `${prefix}-${String(seedCounter).padStart(3, '0')}`;
}

// 결정적 난수 (시드 재현)
let rng = 20261019;
function rand() {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
}
function pick(arr) {
    return arr[Math.floor(rand() * arr.length)];
}

const COMPANY_PREFIX = ['동해', '한빛', '대성', '세진', '유진', '삼원', '태백', '강원', '소양', '설악', '청평', '금강', '한라', '백두', '남양'];
const COMPANY_SUFFIX = ['정밀', '화학', '금속', '테크', '산업', '철강', '전자', '기계', '물류', '에너지', '신소재', '바이오', '시멘트', '자동화', '플라스틱'];
const FACILITY_TYPES = [
    { type: 'factory', label: '제조공장', w: [70, 140], h: [45, 90], roof: 'steel', pv: 0.55 },
    { type: 'warehouse', label: '물류창고', w: [80, 160], h: [40, 70], roof: 'steel', pv: 0.6 },
    { type: 'office', label: '사무동', w: [30, 50], h: [20, 35], roof: 'concrete', pv: 0.3 },
    { type: 'utility', label: '에너지/유틸리티', w: [40, 70], h: [30, 50], roof: 'concrete', pv: 0.25 },
    { type: 'treatment', label: '폐수/폐기물 처리', w: [50, 80], h: [40, 60], roof: 'mixed', pv: 0.1 },
    { type: 'vacant', label: '미분양 필지', w: [60, 100], h: [50, 80], roof: null, pv: 0 },
];
const HAZARDS = ['인화성 액체', '고압가스', '분진', '유기용제', '고온 공정', '중량물', '없음', '없음', '없음'];

function buildSiteLayout(site, { cols, rows, lotW, lotH, gap, rotation = 0, pvRatio = 1 }) {
    const facilities = [];
    const arrays = [];
    const totalW = cols * (lotW + gap);
    const totalH = rows * (lotH + gap);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const dx = -totalW / 2 + c * (lotW + gap) + lotW / 2;
            const dy = -totalH / 2 + r * (lotH + gap) + lotH / 2;
            const [lon, lat] = offsetLonLat(site.lon, site.lat, dx, dy);
            const ft = rand() < 0.08 ? FACILITY_TYPES[5] : pick(FACILITY_TYPES.slice(0, 5));
            const w = ft.w[0] + rand() * (ft.w[1] - ft.w[0]);
            const h = ft.h[0] + rand() * (ft.h[1] - ft.h[0]);
            const ring = rectRing(lon, lat, Math.min(w, lotW - 10), Math.min(h, lotH - 10), rotation);
            const lotRing = rectRing(lon, lat, lotW, lotH, rotation);
            const company = ft.type === 'vacant' ? null : `(주)${pick(COMPANY_PREFIX)}${pick(COMPANY_SUFFIX)}`;
            const facilityId = sid('fac');
            const roofArea = polygonAreaSqm([ring]);
            const hasPv = ft.pv > 0 && rand() < ft.pv * pvRatio;
            const floors = ft.type === 'office' ? 3 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2);
            const facility = {
                id: facilityId,
                siteId: site.id,
                name: company ? `${company} ${ft.label}` : `미분양 필지 ${r + 1}-${c + 1}`,
                company,
                type: ft.type,
                typeLabel: ft.label,
                lotNo: `${site.code}-${r + 1}-${c + 1}`,
                lon, lat,
                floors,
                heightM: floors * (ft.type === 'office' ? 3.6 : 9),
                roofType: ft.roof,
                roofAreaSqm: Math.round(roofArea),
                lotAreaSqm: Math.round(polygonAreaSqm([lotRing])),
                geometry: { type: 'Polygon', coordinates: [ring] },
                lotGeometry: { type: 'Polygon', coordinates: [lotRing] },
                status: ft.type === 'vacant' ? 'vacant' : rand() < 0.9 ? 'operating' : 'maintenance',
                hazard: ft.type === 'vacant' ? '없음' : pick(HAZARDS),
                employees: ft.type === 'vacant' ? 0 : 12 + Math.floor(rand() * 180),
                energyKwhMonth: ft.type === 'vacant' ? 0 : Math.round(roofArea * (8 + rand() * 20)),
                contact: company ? `${company} 안전관리자` : null,
                pvInstalled: hasPv,
                lastInspection: new Date(Date.now() - Math.floor(rand() * 90) * 86400000).toISOString().slice(0, 10),
                riskScore: Math.round(rand() * 60 + (ft.type === 'treatment' ? 25 : 0)),
            };
            facilities.push(facility);

            if (hasPv) {
                const usable = 0.55 + rand() * 0.25;
                const arrW = Math.min(w, lotW - 10) * Math.sqrt(usable);
                const arrH = Math.min(h, lotH - 10) * Math.sqrt(usable);
                const arrRing = rectRing(lon, lat, arrW, arrH, rotation);
                const area = polygonAreaSqm([arrRing]);
                const moduleArea = 2.2; // 550W급 모듈 1매 약 2.2 m2
                const modules = Math.floor((area * 0.78) / moduleArea);
                const capacityKwp = Math.round(modules * 0.55 * 10) / 10;
                arrays.push({
                    id: sid('pv'),
                    siteId: site.id,
                    facilityId,
                    name: `${facility.company || facility.name} 옥상 PV`,
                    geometry: { type: 'Polygon', coordinates: [arrRing] },
                    areaSqm: Math.round(area),
                    moduleCount: modules,
                    moduleWp: 550,
                    capacityKwp,
                    tiltDeg: facility.roofType === 'steel' ? 10 : 20,
                    azimuthDeg: 180 + rotation,
                    inverterCount: Math.max(1, Math.round(capacityKwp / 100)),
                    installedAt: `${2019 + Math.floor(rand() * 7)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-01`,
                    operator: facility.company,
                    lastCleaning: new Date(Date.now() - Math.floor(rand() * 120) * 86400000).toISOString().slice(0, 10),
                    lastThermalInspection: null,
                    health: { status: 'normal', healthFactor: 1, hotspotCount: 0 },
                });
            }
        }
    }
    return { facilities, arrays };
}

function buildSensors(site) {
    const defs = [
        { type: 'air', name: '대기질 측정소 A', dx: -260, dy: 180, baseline: { pm10: 31, pm25: 16, no2: 21 } },
        { type: 'air', name: '대기질 측정소 B', dx: 240, dy: -170, baseline: { pm10: 38, pm25: 19, no2: 26 } },
        { type: 'noise', name: '소음 측정기 1', dx: -220, dy: -200, baseline: { noiseDb: 61 } },
        { type: 'voc', name: '악취/VOC 센서', dx: 180, dy: 210, baseline: { voc: 0.22 } },
        { type: 'weather', name: '단지 기상관측기', dx: 0, dy: -260, baseline: {} },
    ];
    return defs.map((d) => {
        const [lon, lat] = offsetLonLat(site.lon, site.lat, d.dx, d.dy);
        return { id: sid('sen'), siteId: site.id, name: d.name, type: d.type, lon, lat, baseline: d.baseline, installedAt: '2026-03-01', status: 'online' };
    });
}

function buildDocks(site, count = 1) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const [lon, lat] = offsetLonLat(site.lon, site.lat, -300 + i * 600, 240);
        out.push({ id: sid('dock'), siteId: site.id, name: `무인드론스테이션 ${i + 1}`, model: 'DJI Dock 3 / Matrice 4TD', lon, lat, installedAt: '2026-06-15', simulate: true });
    }
    return out;
}

function buildMissions(site, dock, arrays) {
    const base = Date.now();
    return [
        { id: sid('msn'), siteId: site.id, dockId: dock.id, name: '태양광 열화상 정기순찰', type: 'thermal-patrol', status: 'scheduled', scheduledAt: new Date(base + 3600000 * 2).toISOString(), altitudeM: 60, gsdCm: 5.2, durationMin: 22, targets: arrays.slice(0, 6).map((a) => a.id), sensor: 'thermal+rgb', repeat: 'daily 13:00' },
        { id: sid('msn'), siteId: site.id, dockId: dock.id, name: '단지 외곽 보안 순찰', type: 'security-patrol', status: 'scheduled', scheduledAt: new Date(base + 3600000 * 5).toISOString(), altitudeM: 80, gsdCm: 7, durationMin: 18, targets: [], sensor: 'rgb+zoom', repeat: '매일 06:00 / 22:00' },
        { id: sid('msn'), siteId: site.id, dockId: dock.id, name: '정사영상 갱신 매핑', type: 'mapping', status: 'completed', scheduledAt: new Date(base - 86400000 * 3).toISOString(), completedAt: new Date(base - 86400000 * 3 + 3600000).toISOString(), altitudeM: 120, gsdCm: 3.3, durationMin: 41, photos: 612, targets: [], sensor: 'rgb', repeat: 'weekly' },
        { id: sid('msn'), siteId: site.id, dockId: dock.id, name: '야간 열화상 이상감지', type: 'thermal-patrol', status: 'completed', scheduledAt: new Date(base - 86400000).toISOString(), completedAt: new Date(base - 86400000 + 1500000).toISOString(), altitudeM: 60, gsdCm: 5.2, durationMin: 25, photos: 284, targets: arrays.slice(0, 6).map((a) => a.id), sensor: 'thermal', repeat: 'daily 02:00' },
    ];
}

// 합성 열화상 래스터(AAIGrid) 생성 → GeoTIFF 변환
async function buildSyntheticThermal(site, arrays, facilities) {
    const cell = 0.5; // m
    const halfW = 620; // m (6열 × 178 m 배치를 모두 포함)
    const halfH = 360;
    const degLon = 1 / (111320 * Math.cos((site.lat * Math.PI) / 180));
    const degLat = 1 / 111320;
    const west = site.lon - halfW * degLon;
    const south = site.lat - halfH * degLat;
    const cols = Math.round((2 * halfW) / cell);
    const rows = Math.round((2 * halfH) / cell);
    const cellLon = cell * degLon;
    const cellLat = cell * degLat;
    const grid = new Float32Array(cols * rows);
    const ambient = 23.5;
    // 배경: 지면/도로 + 완만한 노이즈
    for (let i = 0; i < grid.length; i++) grid[i] = ambient + (rand() - 0.5) * 2.5;

    const paintRect = (ring, value, jitter) => {
        const lons = ring.map((p) => p[0]);
        const lats = ring.map((p) => p[1]);
        const c0 = Math.max(0, Math.floor((Math.min(...lons) - west) / cellLon));
        const c1 = Math.min(cols - 1, Math.ceil((Math.max(...lons) - west) / cellLon));
        const r0 = Math.max(0, Math.floor((Math.min(...lats) - south) / cellLat));
        const r1 = Math.min(rows - 1, Math.ceil((Math.max(...lats) - south) / cellLat));
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                const lon = west + (c + 0.5) * cellLon;
                const lat = south + (r + 0.5) * cellLat;
                if (!pointInPolygon(lon, lat, [ring])) continue;
                grid[(rows - 1 - r) * cols + c] = value + (rand() - 0.5) * jitter;
            }
        }
    };
    const paintBlob = (lon, lat, radiusM, peak) => {
        const cc = (lon - west) / cellLon;
        const rr = (lat - south) / cellLat;
        const rad = radiusM / cell;
        for (let r = Math.floor(rr - rad); r <= Math.ceil(rr + rad); r++) {
            for (let c = Math.floor(cc - rad); c <= Math.ceil(cc + rad); c++) {
                if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
                const d = Math.hypot(c - cc, r - rr) / rad;
                if (d > 1) continue;
                const idx = (rows - 1 - r) * cols + c;
                grid[idx] = Math.max(grid[idx], peak - (peak - grid[idx]) * d * d);
            }
        }
    };

    // 건물 지붕: 철판 지붕은 뜨겁고 콘크리트는 덜 뜨겁다
    for (const f of facilities) {
        if (f.type === 'vacant') continue;
        paintRect(f.geometry.coordinates[0], f.roofType === 'steel' ? 36 : 31, 3);
    }
    // PV 어레이: 정상 모듈 온도 ~41°C
    for (const a of arrays) paintRect(a.geometry.coordinates[0], 41, 2.5);

    // 핫스팟: 일부 어레이에 셀/바이패스 다이오드 결함, 스트링 개방 등을 모사
    const hotspotPlan = [];
    const affected = arrays.slice(0, Math.min(arrays.length, 5));
    affected.forEach((a, i) => {
        const [clon, clat] = ringCentroid(a.geometry.coordinates[0].slice(0, 4));
        const n = i === 0 ? 4 : i === 1 ? 2 : 1;
        for (let k = 0; k < n; k++) {
            const [lon, lat] = offsetLonLat(clon, clat, (rand() - 0.5) * 16, (rand() - 0.5) * 10);
            const peak = i === 0 ? 78 + rand() * 10 : i === 1 ? 66 + rand() * 6 : 58 + rand() * 8;
            paintBlob(lon, lat, 2.2 + rand() * 2, peak);
            hotspotPlan.push({ arrayId: a.id, lon, lat, peak });
        }
    });
    // 비-PV 고온원: 공장 배기/보일러 (알림 분류 검증용)
    const util = facilities.find((f) => f.type === 'utility') || facilities[0];
    if (util) {
        const [ulon, ulat] = offsetLonLat(util.lon, util.lat, 8, 6);
        paintBlob(ulon, ulat, 3.5, 62);
    }

    const asc = path.join(SYNTH_DIR, `${site.id}-thermal.asc`);
    const header = `ncols ${cols}\nnrows ${rows}\nxllcorner ${west}\nyllcorner ${south}\ncellsize ${cellLon}\nNODATA_value -9999\n`;
    const lines = [];
    for (let r = 0; r < rows; r++) {
        const row = new Array(cols);
        for (let c = 0; c < cols; c++) row[c] = grid[r * cols + c].toFixed(1);
        lines.push(row.join(' '));
    }
    fs.writeFileSync(asc, header + lines.join('\n') + '\n');
    // 주의: cellsize는 경도 기준. 위도 방향 셀 크기가 다르므로 GeoTIFF 변환 시 -a_ullr로 정확한 경계를 지정한다.
    let tif = asc;
    const g = findGdal();
    if (g) {
        try {
            const out = path.join(SYNTH_DIR, `${site.id}-thermal.tif`);
            await run(g.gdal_translate, ['-of', 'GTiff', '-a_srs', 'EPSG:4326', '-a_ullr', String(west), String(south + rows * cellLat), String(west + cols * cellLon), String(south), '-co', 'COMPRESS=DEFLATE', asc, out]);
            tif = out;
        } catch (err) {
            console.warn('[seed] synthetic thermal GeoTIFF failed, using ASC:', err.message);
        }
    }
    return { file: tif, bounds: { west, south, east: west + cols * cellLon, north: south + rows * cellLat }, hotspotPlan, cols, rows };
}

export async function seedDatabase(store) {
    console.log('[seed] 데모 데이터 생성 중...');
    const chCenter = tilesetCenter(LOCAL_ASSETS.chuncheonTileset) || { lon: 127.7335, lat: 37.8865, radius: 3190 };

    const terraSites = TERRA_SITES.filter((s) => fs.existsSync(s.ortho.path) || fs.existsSync(s.thermalDir)).map((s) => ({
        id: s.id, code: s.code, name: s.name, region: s.region, type: s.type, areaHa: s.areaHa, companies: s.companies, established: s.established,
        description: s.description, lon: (s.bounds.west + s.bounds.east) / 2, lat: (s.bounds.south + s.bounds.north) / 2,
        boundary: boundsRing(s.bounds), cameraHeight: s.cameraHeight, pvTargetKwp: s.pvTargetKwp, isReal: true,
    }));
    const sites = [
        ...terraSites,
        {
            id: 'site-bukpyeong', code: 'BP', name: '북평산단 데모 (가상 배치)', region: '강원 동해시 북평동 서측',
            lon: 129.1215, lat: 37.4735, areaHa: 274, companies: 48, established: 1979, type: 'demo',
            description: '시설·PV·센서·열화상이 모두 가상 시드인 데모 단지. 실측 데이터는 "동해산업단지 (실측)"를 선택하세요.',
            boundary: rectRing(129.1215, 37.4735, 1500, 1100, 12), cameraHeight: 2600, pvTargetKwp: 12000, isDemo: true,
        },
        {
            id: 'site-chuncheon', code: 'CC', name: '춘천 3D 실증구역 (후평일반산업단지)', region: '강원 춘천시',
            lon: chCenter.lon, lat: chCenter.lat, areaHa: 62, companies: 120, established: 1985, type: 'general',
            description: '보유 중인 iTwin 3D Tiles(춘천) 실측 모델을 디지털트윈으로 연동한 실증 구역.',
            boundary: rectRing(chCenter.lon, chCenter.lat, 1400, 1000, 0), cameraHeight: 2200, pvTargetKwp: 4000,
        },
        {
            id: 'site-gangchon', code: 'GC', name: '강촌 드론 실증 테스트베드', region: '강원 춘천시 남산면',
            lon: 127.5793, lat: 37.8268, areaHa: 35, companies: 0, established: 2026, type: 'testbed',
            description: '드론 RGB 정사영상(2026-08-15) 및 열화상 촬영 데이터 검증용 구역.',
            boundary: [[127.5695, 37.8328], [127.5698, 37.8205], [127.5891, 37.8207], [127.5889, 37.8331], [127.5695, 37.8328]], cameraHeight: 2400, pvTargetKwp: 500,
        },
    ];
    store.replaceAll('sites', sites.map((s) => ({ ...s, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })));

    const allFacilities = [];
    const allArrays = [];
    const allSensors = [];
    const allDocks = [];
    const allMissions = [];

    const layouts = {
        'site-bukpyeong': { cols: 6, rows: 4, lotW: 150, lotH: 110, gap: 28, rotation: 12, pvRatio: 1 },
        'site-chuncheon': { cols: 5, rows: 3, lotW: 120, lotH: 95, gap: 24, rotation: 0, pvRatio: 0.8 },
        'site-gangchon': { cols: 3, rows: 2, lotW: 110, lotH: 90, gap: 30, rotation: -8, pvRatio: 0.9 },
    };
    for (const site of sites) {
        if (layouts[site.id]) {
            const { facilities, arrays } = buildSiteLayout(site, layouts[site.id]);
            allFacilities.push(...facilities);
            allArrays.push(...arrays);
        }
        // 실측 단지에는 가상 시설/PV를 넣지 않는다 (센서·스테이션은 모의 텔레메트리용으로 최소 구성)
        const sensors = site.isReal ? buildSensors(site).slice(0, 2).map((s) => ({ ...s, name: `${s.name} (모의)` })) : buildSensors(site);
        allSensors.push(...sensors);
        const docks = buildDocks(site, site.id === 'site-bukpyeong' ? 2 : 1).map((d) => (site.isReal ? { ...d, name: `${d.name} (모의)` } : d));
        allDocks.push(...docks);
        allMissions.push(...buildMissions(site, docks[0], allArrays.filter((a) => a.siteId === site.id)));
    }
    store.replaceAll('facilities', allFacilities);
    store.replaceAll('panelArrays', allArrays);
    store.replaceAll('sensors', allSensors);
    store.replaceAll('docks', allDocks);
    store.replaceAll('missions', allMissions);

    // 데이터셋 등록
    const now = new Date().toISOString();
    const datasets = TERRA_SITES.filter((s) => sites.some((x) => x.id === s.id)).flatMap((s) => terraDatasets(s, now));
    if (fs.existsSync(LOCAL_ASSETS.chuncheonTileset)) {
        datasets.push({ id: 'ds-cc-3dtiles', siteId: 'site-chuncheon', name: '춘천 실측 3D Tiles (iTwin 2024-11)', type: '3dtiles', source: 'drone', platform: 'Bentley iTwin Capture', sourcePath: LOCAL_ASSETS.chuncheonTileset, tilesetUrl: '/3dtiles/ds-cc-3dtiles/chuncheon_03_cesium.json', capturedAt: '2024-11-12', status: 'ready', center: chCenter, visibleByDefault: true });
    }
    if (fs.existsSync(LOCAL_ASSETS.chuncheonTileset2)) {
        const c2 = tilesetCenter(LOCAL_ASSETS.chuncheonTileset2);
        datasets.push({ id: 'ds-cc-3dtiles-2', siteId: 'site-chuncheon', name: '춘천 3D Tiles 구역 2 (Production_1)', type: '3dtiles', source: 'drone', platform: 'Bentley iTwin Capture', sourcePath: LOCAL_ASSETS.chuncheonTileset2, tilesetUrl: '/3dtiles/ds-cc-3dtiles-2/Production_1_cesium.json', capturedAt: '2024-11-12', status: 'ready', center: c2, visibleByDefault: false });
    }
    if (fs.existsSync(LOCAL_ASSETS.gangchonOrtho)) {
        datasets.push({ id: 'ds-gc-ortho', siteId: 'site-gangchon', name: '강촌 RGB 정사영상 (2026-08-15)', type: 'orthophoto', source: 'drone', platform: 'DJI Matrice / Pix4D', sourcePath: LOCAL_ASSETS.gangchonOrtho, capturedAt: '2026-08-15', status: 'registered', tilesStatus: 'none', visibleByDefault: true });
    }
    if (fs.existsSync(LOCAL_ASSETS.gangchonVari)) {
        datasets.push({ id: 'ds-gc-vari', siteId: 'site-gangchon', name: '강촌 VARI 식생지수 (2026-08-15)', type: 'ndvi', source: 'drone', platform: 'Pix4D index', sourcePath: LOCAL_ASSETS.gangchonVari, capturedAt: '2026-08-15', status: 'registered', tilesStatus: 'none', visibleByDefault: false });
    }
    if (fs.existsSync(LOCAL_ASSETS.thermalPhotoDir)) {
        datasets.push({ id: 'ds-ir-photos', siteId: 'site-gangchon', name: '열화상 촬영 원본 (DJI M4T, 2026-07-30)', type: 'photos', source: 'drone', platform: 'DJI Matrice 4T', sourcePath: LOCAL_ASSETS.thermalPhotoDir, capturedAt: '2026-07-30', status: 'registered', photoCount: null });
    }

    // 북평: 합성 열화상 GeoTIFF
    const bp = sites.find((s) => s.id === 'site-bukpyeong');
    const bpArrays = allArrays.filter((a) => a.siteId === bp.id);
    const bpFacilities = allFacilities.filter((f) => f.siteId === bp.id);
    try {
        const synth = await buildSyntheticThermal(bp, bpArrays, bpFacilities);
        datasets.push({ id: 'ds-bp-thermal', siteId: bp.id, name: '북평 열화상 정사영상 (합성 데모, 50cm)', type: 'thermal', source: 'drone', platform: '합성 데이터 (DJI M4T 열화상 매핑 가정)', sourcePath: synth.file, bounds: synth.bounds, epsg: 4326, width: synth.cols, height: synth.rows, gsd: 0.5, capturedAt: now.slice(0, 10), status: 'ready', tilesStatus: 'none', isSynthetic: true, isPrimaryThermal: true, visibleByDefault: true, rawIsTemperature: true });
    } catch (err) {
        console.warn('[seed] synthetic thermal skipped:', err.message);
    }
    store.replaceAll('datasets', datasets.map((d) => ({ createdAt: now, updatedAt: now, ...d })));

    // 초기 알림
    const bpSensors = allSensors.filter((s) => s.siteId === 'site-bukpyeong');
    const alerts = [
        { id: sid('alr'), siteId: 'site-bukpyeong', level: 'warning', category: 'environment', title: '대기질 측정소 B PM10 상승', message: '오후 2시 기준 PM10 78 ㎍/㎥ (주의 기준 80 접근). 인근 하역장 분진 추정.', lon: bpSensors[1]?.lon, lat: bpSensors[1]?.lat, acknowledged: false, source: 'sensor', createdAt: new Date(Date.now() - 3600000 * 3).toISOString() },
        { id: sid('alr'), siteId: 'site-bukpyeong', level: 'info', category: 'drone', title: '야간 열화상 순찰 완료', message: '284장 촬영, 핫스팟 후보 7건 추출. 열화상 분석 메뉴에서 확인하세요.', acknowledged: true, source: 'drone', createdAt: new Date(Date.now() - 86400000).toISOString() },
        { id: sid('alr'), siteId: 'site-chuncheon', level: 'warning', category: 'safety', title: '강풍 주의 - 드론 비행 제한', message: '순간풍속 11 m/s 예보. 14:00~17:00 자동 임무 보류.', acknowledged: false, source: 'weather', createdAt: new Date(Date.now() - 3600000).toISOString() },
    ];
    store.replaceAll('alerts', alerts);
    store.replaceAll('workOrders', [
        { id: sid('wo'), siteId: 'site-bukpyeong', title: 'PV 어레이 세척 (하역장 인접 3개동)', status: 'open', priority: 'medium', assignee: 'O&M 협력사', dueDate: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10), createdAt: now, updatedAt: now },
    ]);
    store.save(true);
    console.log(`[seed] 완료: 사이트 ${sites.length}, 시설 ${allFacilities.length}, PV 어레이 ${allArrays.length}, 데이터셋 ${datasets.length}`);
    return { sites, datasets };
}
