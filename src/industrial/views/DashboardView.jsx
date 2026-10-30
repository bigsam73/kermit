import React, { useEffect } from 'react';
import useIndustrialStore from '../store';
import { Section, StatCard, StackBar, ThresholdBar, Badge, Sparkline, Button, fmt, fmtTime, ago } from '../components/ui';
import { Icon } from '../icons';
import { HEALTH_COLORS, HEALTH_LABELS, ALERT_LEVEL_COLORS, ALERT_LEVEL_LABELS, DOCK_STATE_LABELS, MISSION_TYPE_LABELS } from '../constants';

const OK = '#22c55e', WARN = '#f59e0b', BAD = '#ef4444';

function StatusPill({ color, children, title }) {
    return <span className="gi-status" style={{ '--s': color }} title={title}><i />{children}</span>;
}

export default function DashboardView() {
    const summary = useIndustrialStore((s) => s.summary);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const pvHistory = useIndustrialStore((s) => s.pvHistory);
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
    const loadPct = capacity ? ((pv?.totalKw || 0) / capacity) * 100 : 0;
    const openAlerts = alerts.filter((a) => !a.acknowledged).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const wxCur = weather?.current;
    const live = telemetry && Date.now() - new Date(telemetry.at).getTime() < 20000;
    const docks = telemetry?.docks || [];
    const docksActive = docks.filter((d) => d.state !== 'OFFLINE').length;
    const pvDelta = pvHistory.length > 8 ? pvHistory[pvHistory.length - 1] - pvHistory[pvHistory.length - 8] : null;
    const healthCount = (k) => panelArrays.filter((a) => (a.health?.status || 'normal') === k).length;
    const abnormal = panelArrays.filter((a) => a.health?.status && a.health.status !== 'normal');

    return (
        <>
            <Section title={site.name} icon={<Icon name="facility" size={14} />} right={<span>{site.region}</span>}>
                <div className="gi-statusrow">
                    <StatusPill color={live ? OK : WARN} title="실시간 텔레메트리 수신 상태">{live ? '실시간 수신' : '수신 대기'}</StatusPill>
                    <StatusPill color={weather?.droneFlightOk === false ? WARN : OK} title="기상 기준 드론 비행 가능 여부">{weather?.droneFlightOk === false ? '드론 비행 제한' : '드론 비행 가능'}</StatusPill>
                    <StatusPill color={docks.length && !docksActive ? BAD : OK} title="드론 스테이션 가동 수">스테이션 {docksActive}/{docks.length}</StatusPill>
                    <StatusPill color={summary.alerts.critical ? BAD : summary.alerts.open ? WARN : OK} title="미확인 알림">{summary.alerts.critical ? `심각 ${summary.alerts.critical}건` : summary.alerts.open ? `알림 ${summary.alerts.open}건` : '이상 없음'}</StatusPill>
                </div>
                <div className="gi-muted" style={{ lineHeight: 1.5 }}>{site.description}</div>
                <div className="gi-row">
                    <Badge color="#38bdf8">{site.type === 'national' ? '국가산단' : site.type === 'general' ? '일반산단' : '실증 테스트베드'}</Badge>
                    <Badge color="#94a3b8">{fmt(site.areaHa)} ha</Badge>
                    <Badge color="#94a3b8">입주 {fmt(site.companies)}개사</Badge>
                    <Badge color="#94a3b8">조성 {site.established}</Badge>
                </div>
            </Section>

            <div className="gi-grid-2">
                <StatCard icon={<Icon name="zap" size={15} />} tone="ok" label="실시간 발전" value={fmt(pv?.totalKw ?? 0)} unit="kW" delta={pvDelta} spark={pvHistory} sub={`설비 ${fmt(capacity)} kWp`} onClick={() => setMenu('solar')} />
                <StatCard icon={<Icon name="sun" size={15} />} tone="accent" label="오늘 예상 발전량" value={fmt(pvForecast?.total?.todayKwh ?? 0)} unit="kWh" sub={pvForecast?.total ? `손실 ${fmt(pvForecast.total.lossKwh)} kWh · CO₂ ${fmt(pvForecast.co2SavedKgToday)} kg 절감` : '예측 계산 중'} onClick={() => setMenu('solar')} />
                <StatCard icon={<Icon name="hotspot" size={15} />} tone={summary.thermal.critical ? 'bad' : 'default'} label="열 이상 핫스팟" value={summary.thermal.hotspots} unit="건" sub={`심각 ${summary.thermal.critical} · 높음 ${summary.thermal.high}`} onClick={() => setMenu('thermal')} />
                <StatCard icon={<Icon name="bell" size={15} />} tone={summary.alerts.critical ? 'bad' : summary.alerts.open ? 'warn' : 'ok'} label="미확인 알림" value={summary.alerts.open} unit="건" sub={`심각 ${summary.alerts.critical}건`} onClick={() => setMenu('safety')} />
            </div>

            <Section title="실시간 발전 추이" icon={<Icon name="activity" size={14} />} right={<span>{telemetry ? `갱신 ${fmtTime(telemetry.at)}` : '수신 대기'}</span>}>
                <Sparkline data={summary.pv.history} width={370} height={56} color="#22c55e" />
                <ThresholdBar label="설비 가동률" value={loadPct} thresholds={[{ at: 0, color: '#64748b' }, { at: 20, color: '#f59e0b' }, { at: 45, color: '#22c55e' }, { at: 90, color: '#38bdf8' }]} />
                <div className="gi-grid-3">
                    <StatCard icon={<Icon name="sun" size={14} />} label="일사량" value={fmt(telemetry?.env?.ghi ?? wxCur?.shortwave_radiation ?? 0)} unit="W/㎡" />
                    <StatCard icon={<Icon name="gauge" size={14} />} label="기온" value={fmt(telemetry?.env?.ambientC ?? wxCur?.temperature_2m ?? 0, 1)} unit="°C" />
                    <StatCard icon={<Icon name="radio" size={14} />} tone={weather?.droneFlightOk === false ? 'warn' : 'default'} label="풍속" value={fmt(wxCur?.wind_speed_10m ?? 0, 1)} unit="m/s" />
                </div>
            </Section>

            <Section title="PV 어레이 건전성" icon={<Icon name="shield" size={14} />} right={<Button size="xs" onClick={() => setMenu('solar')}>전체</Button>}>
                <StackBar items={['normal', 'watch', 'warning', 'critical'].map((k) => ({ label: HEALTH_LABELS[k], value: healthCount(k), color: HEALTH_COLORS[k] }))} />
                <div className="gi-list">
                    {abnormal.slice(0, 4).map((a) => (
                        <div key={a.id} className="gi-list-item is-clickable" onClick={() => { setSelected({ type: 'panelArray', id: a.id }); }}>
                            <Badge color={HEALTH_COLORS[a.health.status]} dot>{HEALTH_LABELS[a.health.status]}</Badge>
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{a.name}</div>
                                <div className="gi-list-sub">{fmt(a.capacityKwp)} kWp · 핫스팟 {a.health.hotspotCount}건</div>
                                <ThresholdBar label="건전성" value={(a.health.healthFactor || 1) * 100} thresholds={[{ at: 0, color: BAD }, { at: 60, color: '#f97316' }, { at: 80, color: WARN }, { at: 95, color: OK }]} />
                            </div>
                        </div>
                    ))}
                    {!abnormal.length && <div className="gi-empty">이상 어레이 없음</div>}
                </div>
            </Section>

            <div className="gi-grid-2">
                <Section title="시설 현황" icon={<Icon name="facility" size={14} />}>
                    <div className="gi-kv-lite">
                        <div className="gi-between"><span className="gi-muted">전체 시설</span><b>{summary.facilities.total}</b></div>
                        <div className="gi-between"><span className="gi-muted">가동 중</span><b>{summary.facilities.operating}</b></div>
                        <div className="gi-between"><span className="gi-muted">PV 설치</span><b>{summary.facilities.withPv}</b></div>
                        <div className="gi-between"><span className="gi-muted">지붕 면적</span><b>{fmt(summary.facilities.roofAreaSqm)} ㎡</b></div>
                    </div>
                    <ThresholdBar label="가동률" value={summary.facilities.operating} max={summary.facilities.total || 1} thresholds={[{ at: 0, color: BAD }, { at: 50, color: WARN }, { at: 80, color: OK }]} />
                </Section>
                <Section title="드론 운용" icon={<Icon name="plane" size={14} />}>
                    {docks.map((d) => (
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

            <Section title="최근 알림" icon={<Icon name="clock" size={14} />} right={<Button size="xs" onClick={() => setMenu('safety')}>전체</Button>}>
                <div className="gi-timeline">
                    {openAlerts.slice(0, 5).map((a) => (
                        <div key={a.id} className="gi-tl-item" style={{ '--c': ALERT_LEVEL_COLORS[a.level] || '#94a3b8' }}>
                            <div className="gi-tl-time">{ALERT_LEVEL_LABELS[a.level]} · {ago(a.createdAt)}</div>
                            <div className="gi-tl-title">{a.title}</div>
                            <div className="gi-tl-msg">{a.message}</div>
                            <div className="gi-row" style={{ marginTop: 4 }}>
                                {a.lon && <Button size="xs" onClick={() => flyTo({ lon: a.lon, lat: a.lat, height: 260, pitch: -60 })}>위치</Button>}
                                <Button size="xs" onClick={() => ackAlert(a.id)}>확인</Button>
                            </div>
                        </div>
                    ))}
                    {!openAlerts.length && <div className="gi-empty" style={{ marginLeft: -16 }}>미확인 알림 없음</div>}
                </div>
            </Section>
        </>
    );
}
