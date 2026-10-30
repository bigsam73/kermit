// 좌측 메뉴: 4그룹(상황/자산/지도·자료/운영). 형태(그룹/아이콘 레일/아이콘만)는 화면 스타일 메뉴에서 변경
import React from 'react';
import { MENUS, MENU_GROUPS } from '../constants';
import useIndustrialStore from '../store';
import useUiStore from '../uiStore';
import { MenuIcon, Icon } from '../icons';

export default function SideNav() {
    const activeMenu = useIndustrialStore((s) => s.activeMenu);
    const panelOpen = useIndustrialStore((s) => s.panelOpen);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    const togglePanel = useIndustrialStore((s) => s.togglePanel);
    const alerts = useIndustrialStore((s) => s.alerts);
    const hotspots = useIndustrialStore((s) => s.hotspots);
    const openPalette = useUiStore((s) => s.openPalette);
    const openAlerts = alerts.filter((a) => !a.acknowledged).length;
    const criticalHotspots = hotspots.filter((h) => h.severity === 'critical' && h.status !== 'resolved').length;
    const byId = Object.fromEntries(MENUS.map((m) => [m.id, m]));
    // 그룹에 빠진 메뉴가 생겨도 사라지지 않도록 마지막에 모은다
    const grouped = new Set(MENU_GROUPS.flatMap((g) => g.ids));
    const rest = MENUS.filter((m) => !grouped.has(m.id)).map((m) => m.id);
    const groups = rest.length ? [...MENU_GROUPS, { label: '기타', ids: rest }] : MENU_GROUPS;

    const renderItem = (m) => {
        const active = m.id === activeMenu;
        const badge = m.id === 'safety' ? openAlerts : m.id === 'thermal' ? criticalHotspots : 0;
        return (
            <button
                key={m.id}
                className={`gi-sidenav-item ${active ? 'is-active' : ''}`}
                onClick={() => (active && panelOpen ? togglePanel() : setMenu(m.id))}
                title={`${m.label} — ${m.desc}`}
                aria-current={active ? 'page' : undefined}
            >
                <span className="gi-sidenav-icon"><MenuIcon id={m.id} /></span>
                <span className="gi-sidenav-label">{m.label}</span>
                {badge > 0 && <span className="gi-sidenav-badge">{badge}</span>}
            </button>
        );
    };

    return (
        <nav className="gi-sidenav glass-panel pointer-events-auto" aria-label="주 메뉴">
            {groups.map((g) => (
                <React.Fragment key={g.label}>
                    <div className="gi-nav-group">{g.label}</div>
                    {g.ids.map((id) => byId[id]).filter(Boolean).map(renderItem)}
                </React.Fragment>
            ))}
            <div className="gi-nav-foot">
                <button className="gi-sidenav-item" onClick={openPalette} title="검색 · 빠른 이동 (Ctrl+K)">
                    <span className="gi-sidenav-icon"><Icon name="search" size={18} /></span>
                    <span className="gi-sidenav-label">검색</span>
                </button>
            </div>
        </nav>
    );
}
