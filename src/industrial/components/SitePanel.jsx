// 메뉴별 콘텐츠를 담는 도킹 패널
import React, { Suspense } from 'react';
import useIndustrialStore from '../store';
import { MENUS } from '../constants';
import DashboardView from '../views/DashboardView';
import ImageryView from '../views/ImageryView';
import ThermalView from '../views/ThermalView';
import SolarView from '../views/SolarView';
import TwinView from '../views/TwinView';
import FacilityView from '../views/FacilityView';
import ParcelView from '../views/ParcelView';
import LotsView from '../views/LotsView';
import DrawingsView from '../views/DrawingsView';
import EnvView from '../views/EnvView';
import SafetyView from '../views/SafetyView';
import DroneView from '../views/DroneView';
import ReportView from '../views/ReportView';
import SettingsView from '../views/SettingsView';

const VIEWS = {
    dashboard: DashboardView,
    imagery: ImageryView,
    thermal: ThermalView,
    solar: SolarView,
    twin: TwinView,
    facility: FacilityView,
    lots: LotsView,
    parcel: ParcelView,
    cad: DrawingsView,
    env: EnvView,
    safety: SafetyView,
    drone: DroneView,
    report: ReportView,
    settings: SettingsView,
};

export default function SitePanel() {
    const activeMenu = useIndustrialStore((s) => s.activeMenu);
    const panelOpen = useIndustrialStore((s) => s.panelOpen);
    const togglePanel = useIndustrialStore((s) => s.togglePanel);
    const ready = useIndustrialStore((s) => s.ready);
    const error = useIndustrialStore((s) => s.error);
    const menu = MENUS.find((m) => m.id === activeMenu) || MENUS[0];
    const View = VIEWS[menu.id] || DashboardView;

    if (!panelOpen) return null;

    return (
        <aside className={`gi-panel glass-panel pointer-events-auto gi-panel--${menu.id}`}>
            <header className="gi-panel-head">
                <div>
                    <div className="gi-panel-title">{menu.icon} {menu.label}</div>
                    <div className="gi-panel-desc">{menu.desc}</div>
                </div>
                <button className="gi-panel-close" onClick={togglePanel} title="패널 접기">‹</button>
            </header>
            <div className="gi-panel-body">
                {!ready && <div className="gi-empty">서버 연결 중…</div>}
                {ready && error && (
                    <div className="gi-empty gi-error">
                        API 서버에 연결할 수 없습니다: {error}
                        <br />
                        <code>npm run server</code> 로 백엔드(포트 3200)를 먼저 실행하세요.
                    </div>
                )}
                {ready && !error && (
                    <Suspense fallback={<div className="gi-empty">불러오는 중…</div>}>
                        <View />
                    </Suspense>
                )}
            </div>
        </aside>
    );
}
