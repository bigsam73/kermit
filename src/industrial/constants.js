// 산업단지 관제 모듈 상수
export const APP_NAME = 'PICT INDUSTRIAL';
export const APP_SUBTITLE = '산업단지 통합 관제 플랫폼';

export const MENUS = [
    { id: 'dashboard', label: '대시보드', icon: '◈', desc: '단지 현황 요약 · KPI · 실시간 발전' },
    { id: 'imagery', label: '영상자료', icon: '▦', desc: '위성 · 드론 정사영상 · 데이터셋 관리' },
    { id: 'thermal', label: '열화상 분석', icon: '♨', desc: '열화상 정사영상 핫스팟 탐지' },
    { id: 'solar', label: '태양광 관리', icon: '☀', desc: 'PV 어레이 · 발전량 · 건전성' },
    { id: 'twin', label: '3D 트윈', icon: '⬢', desc: '실측 3D Tiles · 디지털트윈' },
    { id: 'facility', label: '시설·입주기업', icon: '▣', desc: '필지 · 건물 · 입주기업 관리' },
    { id: 'env', label: '환경 모니터링', icon: '☁', desc: '기상 · 대기질 · 센서' },
    { id: 'safety', label: '안전·재난', icon: '⚠', desc: '알림 · 위험 시설 · 광역 위험요소' },
    { id: 'drone', label: '드론 운용', icon: '✈', desc: '스테이션 · 임무 · 촬영 사진' },
    { id: 'report', label: '보고서', icon: '≡', desc: '점검 보고서 생성 · 이력' },
    { id: 'settings', label: '설정', icon: '⚙', desc: '단지 · 데이터 경로 · 시스템' },
];

export const INDUSTRIAL_LAYER_KEYS = ['sites', 'facilities', 'solarPanels', 'thermalHotspots', 'imagery', 'tiles3d', 'droneOps', 'sensors'];

export const FACILITY_COLORS = {
    factory: '#60a5fa',
    warehouse: '#a78bfa',
    office: '#34d399',
    utility: '#fbbf24',
    treatment: '#f87171',
    vacant: '#6b7280',
};
export const FACILITY_LABELS = {
    factory: '제조공장', warehouse: '물류창고', office: '사무동', utility: '에너지/유틸리티', treatment: '폐수/폐기물', vacant: '미분양',
};

export const HEALTH_COLORS = { normal: '#22c55e', watch: '#eab308', warning: '#f97316', critical: '#ef4444' };
export const HEALTH_LABELS = { normal: '정상', watch: '관찰', warning: '주의', critical: '심각' };
export const SEVERITY_COLORS = { low: '#38bdf8', medium: '#eab308', high: '#f97316', critical: '#ef4444' };
export const SEVERITY_LABELS = { low: '낮음', medium: '보통', high: '높음', critical: '심각' };
export const ALERT_LEVEL_COLORS = { info: '#38bdf8', warning: '#f59e0b', critical: '#ef4444' };
export const ALERT_LEVEL_LABELS = { info: '정보', warning: '주의', critical: '심각' };
export const DATASET_TYPE_LABELS = { orthophoto: 'RGB 정사영상', thermal: '열화상 정사영상', satellite: '위성영상', '3dtiles': '3D Tiles', pointcloud: '포인트클라우드', dsm: 'DSM/DEM', ndvi: '식생지수', photos: '촬영 원본 사진' };
export const MISSION_TYPE_LABELS = { 'thermal-patrol': '열화상 순찰', 'security-patrol': '보안 순찰', mapping: '매핑', inspection: '시설 점검', emergency: '긴급 출동' };
export const DOCK_STATE_LABELS = { IDLE: '대기', PREFLIGHT: '이륙 준비', IN_MISSION: '임무 중', RETURNING: '복귀 중', CHARGING: '충전 중', OFFLINE: '오프라인' };

// 열화상 컬러맵 (ironbow 근사)
export const IRONBOW = [
    [0, 0, 0], [20, 0, 60], [60, 0, 120], [120, 0, 160], [170, 20, 150], [210, 60, 110],
    [235, 110, 60], [250, 160, 20], [255, 210, 20], [255, 245, 120], [255, 255, 255],
];
export const THERMAL_PALETTES = {
    ironbow: IRONBOW,
    rainbow: [[0, 0, 128], [0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 128, 0], [255, 0, 0], [255, 255, 255]],
    white_hot: [[0, 0, 0], [255, 255, 255]],
};

export const KOREA_CAMERA = { longitude: 128.1, latitude: 36.6, height: 1650000 };
