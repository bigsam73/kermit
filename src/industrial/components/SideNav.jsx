// 좌측 메뉴 레일
import React from 'react';
import { MENUS } from '../constants';
import useIndustrialStore from '../store';

export default function SideNav() {
    const activeMenu = useIndustrialStore((s) => s.activeMenu);
    const panelOpen = useIndustrialStore((s) => s.panelOpen);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    const togglePanel = useIndustrialStore((s) => s.togglePanel);
    const alerts = useIndustrialStore((s) => s.alerts);
    const hotspots = useIndustrialStore((s) => s.hotspots);
    const openAlerts = alerts.filter((a) => !a.acknowledged).length;
    const criticalHotspots = hotspots.filter((h) => h.severity === 'critical' && h.status !== 'resolved').length;

    return (
        <nav className="gi-sidenav glass-panel pointer-events-auto">
            {MENUS.map((m) => {
                const active = m.id === activeMenu;
                const badge = m.id === 'safety' ? openAlerts : m.id === 'thermal' ? criticalHotspots : 0;
                return (
                    <button
                        key={m.id}
                        className={`gi-sidenav-item ${active ? 'is-active' : ''}`}
                        onClick={() => (active && panelOpen ? togglePanel() : setMenu(m.id))}
                        title={m.desc}
                    >
                        <span className="gi-sidenav-icon">{m.icon}</span>
                        <span className="gi-sidenav-label">{m.label}</span>
                        {badge > 0 && <span className="gi-sidenav-badge">{badge}</span>}
                    </button>
                );
            })}
        </nav>
    );
}
