// 화면 스타일(테마·강조색·밀도·메뉴 형태) + 일회성 UI 상태. 스타일은 localStorage에 저장하고 <html data-gi-*>로 적용한다.
import { create } from 'zustand';

const KEY = 'gi:ui';

export const THEMES = [
    { id: 'dark', label: '관제실 다크', desc: '어두운 관제실 · 기본' },
    { id: 'light', label: '현장 라이트', desc: '밝은 환경 · 태블릿/야외' },
    { id: 'contrast', label: '고대비', desc: '큰 모니터 · 가독성 우선' },
];
export const ACCENTS = [
    { id: 'sky', label: '스카이', rgb: '56 189 248', hex: '#38bdf8' },
    { id: 'emerald', label: '에메랄드', rgb: '52 211 153', hex: '#34d399' },
    { id: 'amber', label: '앰버', rgb: '251 191 36', hex: '#fbbf24' },
    { id: 'violet', label: '바이올렛', rgb: '167 139 250', hex: '#a78bfa' },
    { id: 'rose', label: '로즈', rgb: '251 113 133', hex: '#fb7185' },
];
export const DENSITIES = [
    { id: 'normal', label: '표준' },
    { id: 'compact', label: '촘촘하게' },
];
export const NAV_STYLES = [
    { id: 'grouped', label: '그룹 메뉴', desc: '4개 그룹 · 글자 포함' },
    { id: 'rail', label: '아이콘 레일', desc: '기존 방식 · 아이콘+작은 글자' },
    { id: 'icons', label: '아이콘만', desc: '지도 면적 최대' },
];
export const PRESETS = [
    { id: 'control', label: '관제실', desc: '다크 · 그룹 메뉴 · 표준', style: { theme: 'dark', accent: 'sky', density: 'normal', nav: 'grouped' } },
    { id: 'field', label: '현장 점검', desc: '라이트 · 아이콘 레일 · 표준', style: { theme: 'light', accent: 'sky', density: 'normal', nav: 'rail' } },
    { id: 'wallscreen', label: '대형 모니터', desc: '고대비 · 아이콘만 · 표준', style: { theme: 'contrast', accent: 'amber', density: 'normal', nav: 'icons' } },
    { id: 'dense', label: '데이터 작업', desc: '다크 · 그룹 메뉴 · 촘촘하게', style: { theme: 'dark', accent: 'emerald', density: 'compact', nav: 'grouped' } },
];

export const MATERIALS = [
    { id: 'glass', label: '리퀴드 글래스', desc: '반투명 블러 + 빛 테두리' },
    { id: 'solid', label: '단색 패널', desc: '선명 · 가벼움' },
];
export const MOTIONS = [
    { id: 'full', label: '모션 켜기', desc: '입장 · 숫자 카운트업' },
    { id: 'reduced', label: '모션 줄이기', desc: '정적 · 저사양/접근성' },
];

const DEFAULT_STYLE = { theme: 'dark', accent: 'sky', density: 'normal', nav: 'grouped', material: 'glass', motion: 'full' };

function load() {
    try {
        return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
        return { ...DEFAULT_STYLE };
    }
}

export function applyStyle(style, wall = false) {
    const r = document.documentElement;
    const accent = ACCENTS.find((a) => a.id === style.accent) || ACCENTS[0];
    r.dataset.giTheme = style.theme;
    r.dataset.giDensity = style.density;
    r.dataset.giNav = style.nav;
    r.dataset.giMaterial = style.material;
    r.dataset.giMotion = style.motion;
    r.dataset.giWall = wall ? '1' : '0';
    r.style.setProperty('--gi-accent-rgb', accent.rgb);
    r.style.setProperty('--gi-accent', accent.hex);
}

const initial = load();
applyStyle(initial);

const useUiStore = create((set, get) => ({
    style: initial,
    wall: false,
    styleMenuOpen: false,
    paletteOpen: false,
    alertCenterOpen: false,

    setStyle: (patch) => {
        const style = { ...get().style, ...patch };
        try { localStorage.setItem(KEY, JSON.stringify(style)); } catch { /* 저장 불가 환경 */ }
        applyStyle(style, get().wall);
        set({ style });
    },
    resetStyle: () => get().setStyle({ ...DEFAULT_STYLE }),
    cycleTheme: () => {
        const i = THEMES.findIndex((t) => t.id === get().style.theme);
        get().setStyle({ theme: THEMES[(i + 1) % THEMES.length].id });
    },
    setWall: (wall) => {
        applyStyle(get().style, wall);
        set({ wall, alertCenterOpen: wall ? true : get().alertCenterOpen, styleMenuOpen: false, paletteOpen: false });
        try {
            if (wall && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
            if (!wall && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        } catch { /* 전체화면 미지원 */ }
    },
    toggleStyleMenu: () => set((s) => ({ styleMenuOpen: !s.styleMenuOpen, alertCenterOpen: false })),
    closeStyleMenu: () => set({ styleMenuOpen: false }),
    openPalette: () => set({ paletteOpen: true, styleMenuOpen: false }),
    closePalette: () => set({ paletteOpen: false }),
    toggleAlertCenter: () => set((s) => ({ alertCenterOpen: !s.alertCenterOpen, styleMenuOpen: false })),
    closeAlertCenter: () => set({ alertCenterOpen: false }),
}));

export default useUiStore;
