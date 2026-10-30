// lucide(https://github.com/lucide-icons/lucide) 아이콘 매핑 — 메뉴 id → 아이콘. 새 메뉴를 추가하면 여기에 등록
import React from 'react';
import {
    LayoutDashboard, Images, Thermometer, Sun, Box, Factory, PenLine, MapPinned, Ruler, Cloud, TriangleAlert, Plane, FileText, Settings,
    Search, Bell, Palette, Monitor, Contrast, House, MapPin, Flame, Building2, X, CircleHelp, Zap, Activity, Gauge, Clock, Radio, ShieldCheck,
    SlidersHorizontal, List, Plus, Wrench, Camera, Database, Layers, Upload, Droplets, Wind, Map, Cpu, Thermometer as Thermo, ClipboardList, History,
} from 'lucide-react';

const MENU_ICONS = {
    dashboard: LayoutDashboard,
    imagery: Images,
    thermal: Thermometer,
    solar: Sun,
    twin: Box,
    facility: Factory,
    lots: PenLine,
    parcel: MapPinned,
    cad: Ruler,
    env: Cloud,
    safety: TriangleAlert,
    drone: Plane,
    report: FileText,
    settings: Settings,
};

const NAMED = { search: Search, bell: Bell, palette: Palette, wall: Monitor, contrast: Contrast, site: House, parcel: MapPin, hotspot: Flame, facility: Building2, close: X, zap: Zap, activity: Activity, gauge: Gauge, clock: Clock, radio: Radio, shield: ShieldCheck, sun: Sun, plane: Plane, sliders: SlidersHorizontal, list: List, plus: Plus, wrench: Wrench, camera: Camera, database: Database, layers: Layers, upload: Upload, drops: Droplets, wind: Wind, map: Map, cpu: Cpu, thermo: Thermo, clipboard: ClipboardList, history: History };

// 제목/라벨의 키워드로 아이콘을 고른다 (Section·Stat 자동 아이콘). 위에서부터 먼저 맞는 규칙 사용
const KEYWORDS = [
    [/알림|경보|재난|위험|안전/, 'bell'], [/핫스팟|열 이상|열화상|과열/, 'hotspot'], [/출력|발전|전력|kW|PV 출력/, 'zap'], [/일사|태양|PV|어레이|패널/, 'sun'],
    [/기온|온도/, 'thermo'], [/풍속|바람/, 'wind'], [/습도|강수|PM|미세|대기|먼지|오염|수질/, 'drops'], [/드론|스테이션|임무|비행/, 'plane'],
    [/촬영|사진|영상|정사/, 'camera'], [/시설|건물|입주|상호|기업/, 'facility'], [/필지|주소|지번|지적/, 'parcel'], [/도면|레이어|중첩/, 'layers'],
    [/센서|측정/, 'radio'], [/작업|유지보수|점검|정비/, 'wrench'], [/이력|기록|로그/, 'history'], [/목록|리스트/, 'list'],
    [/등록|추가|업로드|기입/, 'plus'], [/표시|옵션|설정|기준|임계/, 'sliders'], [/분석|추이|통계|현황/, 'activity'], [/보고|리포트/, 'clipboard'],
    [/데이터|저장|경로|서버/, 'database'], [/3D|트윈|타일/, 'map'],
];
export function autoIconName(text) {
    if (typeof text !== 'string') return null;
    const hit = KEYWORDS.find(([re]) => re.test(text));
    return hit ? hit[1] : null;
}

export function MenuIcon({ id, size = 18, ...rest }) {
    const Icon = MENU_ICONS[id] || CircleHelp;
    return <Icon size={size} strokeWidth={1.9} aria-hidden="true" {...rest} />;
}

export function Icon({ name, size = 16, ...rest }) {
    const C = NAMED[name] || CircleHelp;
    return <C size={size} strokeWidth={1.9} aria-hidden="true" {...rest} />;
}
