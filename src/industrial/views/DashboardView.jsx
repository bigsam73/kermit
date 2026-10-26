import React, { useEffect } from 'react';
import useIndustrialStore from '../store';
import { Section, Stat, Badge, Sparkline, Bar, Button, fmt, fmtTime, ago } from '../components/ui';
import { HEALTH_COLORS, HEALTH_LABELS, ALERT_LEVEL_COLORS, ALERT_LEVEL_LABELS, DOCK_STATE_LABELS, MISSION_TYPE_LABELS } from '../constants';

export default function DashboardView() {
    const summary = useIndustrialStore((s) => s.summary);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const weather = useIndustrialStore((s) => s.weather);
    const pvForecast = useIndustrialStore((s) => s.pvForecast);
    const panelArrays = useIndustrialStore((s) => s.panelArrays);
    const alerts = useIndustrialStore((s) => s.alerts);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    const refreshSummary = useIndustrialStore((s) => s.refreshSummary);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const ackAlert = useIndustrialStore((s) => s.ackAlert);
    const site = useIndustrialStore((s) => s.sites.find((x) => x.id === s.activeSiteId));

    useEffect(() => {
        const t = setInterval(() => refreshSummary(), 30000);
        return () => clearInterval(t);
    }, [refreshSummary]);

    if (!summary || !site) return <div className="gi-empty">단지 정보를 불러오는 중…</div>;

    const pv = telemetry?.pv;
    const capacity = pv?.capacityKwp || summary.pv.capacityKwp || 1;
    const openAlerts = alerts.filter((a) => !a.acknowledged).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const wxCur = weather?.current;

    return (
        <>
            <Section title={site.name} right={<span>{site.region}</span>}>
                <div className="gi-muted" style={{ lineHeight: 1.5 }}>{site.description}</div>
                <div className="gi-row">
                    <Badge color="#38bdf8">{site.type === 'national' ? '국가산단' : site.type === 'general' ? '일반산단' : '실증 테스트베드'}</Badge>
                    <Badge color="#94a3b8">{fmt(site.areaHa)} ha</Badge>
                    <Badge color="#94a3b8">입주 {fmt(site.companies)}개사</Badge>
                    <Badge color="#94a3b8">조성 {site.established}</Badge>
                </div>
            </Section>

            <div className="gi-grid-2">
                <Stat label="실시간 발전" value={fmt(pv?.totalKw ?? 0)} unit="kW" tone="ok" sub={`설비 ${fmt(capacity)} kWp · ${capacity ? Math.round(((pv?.totalKw || 0) / capacity) * 100) : 0}% 가동`} onClick={() => setMenu('solar')} />
                <Stat label="오늘 예상 발전량" value={fmt(pvForecast?.total?.todayKwh ?? 0)} unit="kWh" tone="accent" sub={pvForecast?.total ? `손실 ${fmt(pvForecast.total.lossKwh)} kWh · CO₂ ${fmt(pvForecast.co2SavedKgToday)} kg 절감` : '예측 계산 중'} onClick={() => setMenu('solar')} />
                <Stat label="열 이상 핫스팟" value={summary.thermal.hotspots} tone={summary.thermal.critical ? 'bad' : 'default'} sub={`심각 ${summary.thermal.critical} · 높음 ${summary.thermal.high}`} onClick={() => setMenu('thermal')} />
                <Stat label="미확인 알림" value={summary.alerts.open} tone={summary.alerts.critical ? 'bad' : summary.alerts.open ? 'warn' : 'ok'} sub={`심각 ${summary.alerts.critical}건`} onClick={() => setMenu('safety')} />
            </div>

            <Section title="실시간 발전 추이" right={<span>{telemetry ? `갱신 ${fmtTime(telemetry.at)}` : '수신 대기'}</span>}>
                <Sparkline data={summary.pv.history} width={370} height={56} color="#22c55e" />
                <div className="gi-grid-3">
                    <Stat label="일사량" value={fmt(telemetry?.env?.ghi ?? wxCur?.shortwave_radiation ?? 0)} unit="W/㎡" />
                    <Stat label="기온" value={fmt(telemetry?.env?.ambientC ?? wxCur?.temperature_2m ?? 0, 1)} unit="°C" />
                    <Stat label="풍속" value={fmt(wxCur?.wind_speed_10m ?? 0, 1)} unit="m/s" sub={weather?.droneFlightOk === false ? '드론 비행 제한' : weather?.droneFlightOk ? '드론 비행 가능' : ''} tone={weather?.droneFlightOk === false ? 'warn' : 'default'} />
                </div>
            </Section>

            <Section title="PV 어레이 건전성" right={<Button size="xs" onClick={() => setMenu('solar')}>전체</Button>}>
                <div className="gi-row">
                    {['normal', 'watch', 'warning', 'critical'].map((k) => (
                        <Badge key={k} color={HEALTH_COLORS[k]} dot>{HEALTH_LABELS[k]} {panelArrays.filter((a) => (a.health?.status || 'normal') === k).length}</Badge>
                    ))}
                </div>
                <div className="gi-list">
                    {panelArrays.filter((a) => a.health?.status && a.health.status !== 'normal').slice(0, 4).map((a) => (
                        <div key={a.id} className="gi-list-item is-clickable" onClick={() => { setSelected({ type: 'panelArray', id: a.id }); }}>
                            <Badge color={HEALTH_COLORS[a.health.status]} dot>{HEALTH_LABELS[a.health.status]}</Badge>
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{a.name}</div>
                                <div className="gi-list-sub">{fmt(a.capacityKwp)} kWp · 핫스팟 {a.health.hotspotCount}건 · 건전성 {Math.round((a.health.healthFactor || 1) * 100)}%</div>
                                <Bar value={(a.health.healthFactor || 1) * 100} color={HEALTH_COLORS[a.health.status]} height={4} />
                            </div>
                        </div>
                    ))}
                    {!panelArrays.some((a) => a.health?.status && a.health.status !== 'normal') && <div className="gi-empty">이상 어레이 없음</div>}
                </div>
            </Section>

            <div className="gi-grid-2">
                <Section title="시설 현황">
                    <div className="gi-kv-lite">
                        <div className="gi-between"><span className="gi-muted">전체 시설</span><b>{summary.facilities.total}</b></div>
                        <div className="gi-between"><span className="gi-muted">가동 중</span><b>{summary.facilities.operating}</b></div>
                        <div className="gi-between"><span className="gi-muted">PV 설치</span><b>{summary.facilities.withPv}</b></div>
                        <div className="gi-between"><span className="gi-muted">지붕 면적</span><b>{fmt(summary.facilities.roofAreaSqm)} ㎡</b></div>
                    </div>
                </Section>
                <Section title="드론 운용">
                    {(telemetry?.docks || []).map((d) => (
                        <div key={d.dockId} className="gi-between" style={{ fontSize: 11 }}>
                            <span className="gi-muted">{d.name}</span>
                            <Badge color={d.state === 'IN_MISSION' ? '#38bdf8' : d.state === 'CHARGING' ? '#f59e0b' : '#22c55e'} dot>{DOCK_STATE_LABELS[d.state]} {d.battery}%</Badge>
                        </div>
                    ))}
                    {summary.missions.next && (
                        <div className="gi-list-sub">다음 임무: {summary.missions.next.name} ({MISSION_TYPE_LABELS[summary.missions.next.type]}) · {fmtTime(summary.missions.next.scheduledAt)}</div>
                    )}
                </Section>
            </div>

            <Section title="최근 알림" right={<Button size="xs" onClick={() => setMenu('safety')}>전체</Button>}>
                <div className="gi-list">
                    {openAlerts.slice(0, 5).map((a) => (
                        <div key={a.id} className="gi-list-item">
                            <Badge color={ALERT_LEVEL_COLORS[a.level]} dot>{ALERT_LEVEL_LABELS[a.level]}</Badge>
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{a.title}</div>
                                <div className="gi-list-sub">{a.message}</div>
                                <div className="gi-row" style={{ marginTop: 4 }}>
                                    <span className="gi-muted">{ago(a.createdAt)}</span>
                                    {a.lon && <Button size="xs" onClick={() => flyTo({ lon: a.lon, lat: a.lat, height: 260, pitch: -60 })}>위치</Button>}
                                    <Button size="xs" onClick={() => ackAlert(a.id)}>확인</Button>
                                </div>
                            </div>
                        </div>
                    ))}
                    {!openAlerts.length && <div className="gi-empty">미확인 알림 없음</div>}
                </div>
            </Section>
        </>
    );
}
