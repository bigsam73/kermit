// 상단바: 브랜드 · 단지 선택 · KST 시계 · 기상/연결 칩 · 피드 패널 · 2D/3D
import React, { useEffect, useState } from 'react';
import useStore from '../../store/useStore';
import useIndustrialStore from '../store';
import { APP_NAME, APP_SUBTITLE } from '../constants';
import useUiStore from '../uiStore';
import { Icon } from '../icons';
import { fmt } from './ui';

export default function TopBarIndustrial() {
    const [time, setTime] = useState(new Date());
    const sites = useIndustrialStore((s) => s.sites);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const setActiveSite = useIndustrialStore((s) => s.setActiveSite);
    const weather = useIndustrialStore((s) => s.weather);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const error = useIndustrialStore((s) => s.error);
    const jobs = useIndustrialStore((s) => s.jobs);
    const toggleLayerPanel = useStore((s) => s.toggleLayerPanel);
    const layerPanelOpen = useStore((s) => s.layerPanelOpen);
    const activeFeedCount = useStore((s) => s.getActiveFeedCount());
    const globeViewMode = useStore((s) => s.globeViewMode);
    const toggleGlobeViewMode = useStore((s) => s.toggleGlobeViewMode);
    const toggleSysTerminal = useStore((s) => s.toggleSysTerminal);
    const appIsActive = useStore((s) => s.appIsActive);
    const alerts = useIndustrialStore((s) => s.alerts);
    const openAlerts = alerts.filter((a) => !a.acknowledged).length;
    const alertCenterOpen = useUiStore((s) => s.alertCenterOpen);
    const toggleAlertCenter = useUiStore((s) => s.toggleAlertCenter);
    const styleMenuOpen = useUiStore((s) => s.styleMenuOpen);
    const toggleStyleMenu = useUiStore((s) => s.toggleStyleMenu);
    const openPalette = useUiStore((s) => s.openPalette);
    const wall = useUiStore((s) => s.wall);
    const setWall = useUiStore((s) => s.setWall);
    const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

    useEffect(() => {
        if (!appIsActive) return undefined;
        const t = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(t);
    }, [appIsActive]);

    const kst = time.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const live = telemetry && Date.now() - new Date(telemetry.at).getTime() < 20000;

    return (
        <div className="gi-topbar absolute top-0 left-0 right-0 pointer-events-none z-10 flex justify-between items-start" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))', paddingLeft: 'max(20px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
            <div className="flex flex-col pointer-events-auto animate-slide-left">
                <div className="gi-topbar-brand">
                    <div className={`w-3.5 h-3.5 rounded-full ${error ? 'bg-neon-red' : live ? 'bg-neon-green' : 'bg-neon-amber'} animate-pulse`} style={{ boxShadow: `0 0 10px ${error ? '#ff3333' : live ? '#00ff41' : '#ffaa00'}` }} />
                    <div>
                        <div className="gi-topbar-title">{APP_NAME}</div>
                        <div className="gi-topbar-sub">{APP_SUBTITLE} · 위성 · 드론 열화상 · 3D 디지털트윈</div>
                    </div>
                </div>
                <div className="gi-site-select">
                    <select className="gi-input" value={activeSiteId || ''} onChange={(e) => setActiveSite(e.target.value)}>
                        {sites.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.region}</option>)}
                        {!sites.length && <option value="">단지 불러오는 중…</option>}
                    </select>
                </div>
            </div>

            <div className="gi-topbar-right pointer-events-auto animate-slide-right">
                <div className="gi-clock">● KST {kst}</div>
                <div className="gi-chip-row">
                    {weather?.current && (
                        <div className="glass-panel gi-chip" title={weather.description}>
                            <span>{weather.description}</span><b>{fmt(weather.current.temperature_2m, 1)}°C</b><span>풍속 <b>{fmt(weather.current.wind_speed_10m, 1)}</b> m/s</span><span>일사 <b>{fmt(weather.current.shortwave_radiation)}</b> W/㎡</span>
                        </div>
                    )}
                    <div className="glass-panel gi-chip" title="실시간 텔레메트리 연결 상태">{live ? <span style={{ color: '#22c55e' }}>● LIVE</span> : <span style={{ color: '#f59e0b' }}>○ 연결 대기</span>}{running > 0 && <span>· 작업 <b>{running}</b></span>}</div>
                    <button type="button" className="glass-panel gi-chip is-clickable" onClick={openPalette} title="검색 · 빠른 이동"><Icon name="search" size={13} /> 검색 <kbd>Ctrl K</kbd></button>
                    <button type="button" className={`glass-panel gi-chip is-clickable ${alertCenterOpen ? 'is-on' : ''}`} onClick={toggleAlertCenter} title="알림 센터"><Icon name="bell" size={13} /> 알림 {openAlerts > 0 && <span className="gi-bell-n">{openAlerts}</span>}</button>
                    <button type="button" className={`glass-panel gi-chip is-clickable ${styleMenuOpen ? 'is-on' : ''}`} onClick={toggleStyleMenu} title="화면 스타일 — 테마 · 강조색 · 밀도 · 메뉴 형태"><Icon name="palette" size={13} /> 화면</button>
                    <button type="button" className={`glass-panel gi-chip is-clickable ${wall ? 'is-on' : ''}`} onClick={() => setWall(!wall)} title="관제 월 모드 (전체화면 · 큰 글씨 · 자동 순회)"><Icon name="wall" size={13} /> 월</button>
                    <div className={`glass-panel gi-chip is-clickable is-hide-wall ${layerPanelOpen ? 'border-electric-blue/60' : ''}`} onClick={toggleLayerPanel} title="데이터 레이어 패널">피드 <b>{activeFeedCount}</b></div>
                    <div className="glass-panel gi-chip is-clickable is-hide-wall" onClick={toggleGlobeViewMode} title="3D 지구본 / 2D 지도 전환">{globeViewMode === 'planet' ? '3D' : '2D'}</div>
                    <div className="glass-panel gi-chip is-clickable is-hide-wall" onClick={toggleSysTerminal} title="시스템 로그">LOG</div>
                </div>
            </div>
        </div>
    );
}
