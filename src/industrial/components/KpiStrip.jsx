// 우측 상단 KPI 스트립 + 열화상 범례
import React from 'react';
import useIndustrialStore from '../store';
import { fmt, AnimNumber } from './ui';
import { THERMAL_PALETTES } from '../constants';

function Spark({ data, color }) {
    if (!data || data.length < 3) return null;
    const W = 120, H = 22;
    const mn = Math.min(...data), mx = Math.max(...data), span = mx - mn || 1;
    const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - mn) / span) * (H - 4)).toFixed(1)}`).join(' ');
    return (
        <svg className="gi-kpi-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

export default function KpiStrip() {
    const summary = useIndustrialStore((s) => s.summary);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const pvForecast = useIndustrialStore((s) => s.pvForecast);
    const pvHistory = useIndustrialStore((s) => s.pvHistory);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    if (!summary) return null;
    const capacity = telemetry?.pv?.capacityKwp || summary.pv.capacityKwp || 0;
    const items = [
        { label: 'PV 출력', value: fmt(telemetry?.pv?.totalKw ?? 0), unit: 'kW', sub: `/ ${fmt(capacity)} kWp`, menu: 'solar', color: '#22c55e', spark: pvHistory, trend: pvHistory.length > 8 ? pvHistory[pvHistory.length - 1] - pvHistory[pvHistory.length - 8] : 0 },
        { label: '오늘 발전', value: fmt(pvForecast?.total?.todayKwh ?? 0), unit: 'kWh', sub: `손실 ${fmt(pvForecast?.total?.lossKwh ?? 0)}`, menu: 'solar', color: '#38bdf8' },
        { label: '핫스팟', value: summary.thermal.hotspots, sub: `심각 ${summary.thermal.critical}`, menu: 'thermal', color: summary.thermal.critical ? '#ef4444' : '#f97316', urgent: summary.thermal.critical > 0 },
        { label: '알림', value: summary.alerts.open, sub: `심각 ${summary.alerts.critical}`, menu: 'safety', color: summary.alerts.critical ? '#ef4444' : summary.alerts.open ? '#f59e0b' : '#22c55e', urgent: summary.alerts.critical > 0 },
    ];
    return (
        <div className="gi-kpi-strip pointer-events-auto">
            {items.map((it) => (
                <div key={it.label} className="glass-panel gi-kpi" style={{ cursor: 'pointer', borderColor: `${it.color}55` }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setMenu(it.menu)} onClick={() => setMenu(it.menu)}>
                    <div className="gi-kpi-label">{it.label}{it.urgent && <span className="gi-kpi-pill">조치 필요</span>}</div>
                    <div className="gi-kpi-value" style={{ color: it.color }}><AnimNumber value={it.value} />{it.unit && <small>{it.unit}</small>}</div>
                    <div className="gi-kpi-sub">{it.sub}{Math.abs(it.trend || 0) >= 0.5 && <span className={`gi-kpi-trend ${it.trend > 0 ? 'up' : 'down'}`}>{it.trend > 0 ? '▲' : '▼'} {fmt(Math.abs(it.trend))} kW</span>}</div>
                    <Spark data={it.spark} color={it.color} />
                </div>
            ))}
        </div>
    );
}

export function ThermalLegend() {
    const datasets = useIndustrialStore((s) => s.datasets);
    const overlayState = useIndustrialStore((s) => s.overlayState);
    const thermal = useIndustrialStore((s) => s.thermal);
    const ranges = useIndustrialStore((s) => s.thermalRange);
    const active = datasets.find((d) => d.type === 'thermal' && overlayState[d.id]?.visible);
    if (!active) return null;
    const tilesMode = Boolean(active.tilesUrl) && overlayState[active.id]?.mode !== 'grid';
    if (tilesMode) {
        return (
            <div className="gi-thermal-legend glass-panel pointer-events-auto">
                <div className="gi-between"><span>열화상 · DJI Terra 팔레트 타일</span><span>{active.capturedAt}</span></div>
                <div className="gi-muted">영상 통계: {active.thermalStats ? `${active.thermalStats.min}~${active.thermalStats.max} °C · 중앙값 ${active.thermalStats.median} °C` : '-'} · 열화상 메뉴에서 "온도 그리드 컬러맵"으로 전환 가능</div>
            </div>
        );
    }
    const stops = THERMAL_PALETTES[thermal.palette] || THERMAL_PALETTES.ironbow;
    const grad = `linear-gradient(90deg, ${stops.map((c) => `rgb(${c.join(',')})`).join(', ')})`;
    const r = ranges[active.id] || {};
    const lo = thermal.min ?? r.min ?? active.thermalStats?.min ?? 0;
    const hi = thermal.max ?? r.max ?? active.thermalStats?.max ?? 100;
    return (
        <div className="gi-thermal-legend glass-panel pointer-events-auto">
            <div className="gi-between"><span>열화상 · {thermal.palette}</span><span>{active.capturedAt}</span></div>
            <div className="gi-colorbar" style={{ background: grad }} />
            <div className="gi-between"><span>{Number(lo).toFixed(0)} °C</span><span>{((Number(lo) + Number(hi)) / 2).toFixed(0)} °C</span><span>{Number(hi).toFixed(0)} °C</span></div>
        </div>
    );
}
