// 태양광 관리: 어레이 목록 · 실시간 인버터 · 발전 예측 · 세척/점검 일정
import React, { useMemo, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Stat, Badge, Button, Table, Sparkline, Bar, Gauge, fmt, fmtDate } from '../components/ui';
import { HEALTH_COLORS, HEALTH_LABELS } from '../constants';

export default function SolarView() {
    const panelArrays = useIndustrialStore((s) => s.panelArrays);
    const facilities = useIndustrialStore((s) => s.facilities);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const pvForecast = useIndustrialStore((s) => s.pvForecast);
    const summary = useIndustrialStore((s) => s.summary);
    const workOrders = useIndustrialStore((s) => s.workOrders);
    const selected = useIndustrialStore((s) => s.selected);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const refreshEnvironment = useIndustrialStore((s) => s.refreshEnvironment);
    const site = useIndustrialStore((s) => s.sites.find((x) => x.id === s.activeSiteId));
    const drawMode = useIndustrialStore((s) => s.drawMode);
    const setDrawMode = useIndustrialStore((s) => s.setDrawMode);
    const [sort, setSort] = useState('health');

    const liveByArray = useMemo(() => Object.fromEntries((telemetry?.pv?.inverters || []).map((i) => [i.arrayId, i])), [telemetry]);
    const fcByArray = useMemo(() => Object.fromEntries((pvForecast?.arrays || []).map((a) => [a.arrayId, a])), [pvForecast]);
    const rank = { critical: 0, warning: 1, watch: 2, normal: 3 };
    const rows = useMemo(() => [...panelArrays].sort((a, b) => {
        if (sort === 'health') return (rank[a.health?.status || 'normal'] - rank[b.health?.status || 'normal']) || b.capacityKwp - a.capacityKwp;
        if (sort === 'capacity') return b.capacityKwp - a.capacityKwp;
        if (sort === 'power') return (liveByArray[b.id]?.powerKw || 0) - (liveByArray[a.id]?.powerKw || 0);
        return a.name.localeCompare(b.name);
    }), [panelArrays, sort, liveByArray]);

    const capacity = panelArrays.reduce((s, a) => s + (a.capacityKwp || 0), 0);
    const totalKw = telemetry?.pv?.totalKw || 0;
    const sel = selected?.type === 'panelArray' ? panelArrays.find((a) => a.id === selected.id) : null;

    const createCleaningOrder = async (a) => {
        await api.post('/api/workOrders', { siteId: a.siteId, title: `${a.name} 세척`, refType: 'panelArray', refId: a.id, status: 'open', priority: a.health?.status === 'critical' ? 'high' : 'medium', dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), assignee: 'O&M 협력사' });
        refreshCollection('workOrders');
    };
    const createInspectionOrder = async (a) => {
        await api.post('/api/workOrders', { siteId: a.siteId, title: `${a.name} 현장 열화상/IV 점검`, refType: 'panelArray', refId: a.id, status: 'open', priority: 'high', dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), assignee: '전기안전관리자' });
        refreshCollection('workOrders');
    };

    return (
        <>
            <div className="gi-grid-2">
                <Stat label="현재 출력" value={fmt(totalKw)} unit="kW" tone="ok" sub={`설비 ${fmt(capacity)} kWp · ${panelArrays.length}개 어레이`} />
                <Stat label="오늘 / 내일 예상" value={`${fmt(pvForecast?.total?.todayKwh ?? 0)}`} unit="kWh" tone="accent" sub={`내일 ${fmt(pvForecast?.total?.tomorrowKwh ?? 0)} kWh · 수익 ≈ ${fmt(pvForecast?.revenueKrwToday ?? 0)}원`} />
            </div>
            <Section title="발전 현황" right={<Button size="xs" onClick={() => refreshEnvironment()}>예측 갱신</Button>}>
                <div className="gi-row" style={{ justifyContent: 'space-around' }}>
                    <Gauge value={totalKw} max={capacity || 1} label="가동률" color="#22c55e" />
                    <Gauge value={capacity} max={site?.pvTargetKwp || capacity || 1} label={`목표 ${fmt(site?.pvTargetKwp || 0)} kWp`} color="#38bdf8" />
                    <Gauge value={panelArrays.filter((a) => (a.health?.status || 'normal') === 'normal').length} max={panelArrays.length || 1} label="정상 어레이" color="#a78bfa" />
                </div>
                <Sparkline data={summary?.pv?.history || []} width={370} height={48} color="#22c55e" />
                <div className="gi-muted">일사량 {telemetry?.env?.ghi ?? pvForecast?.current?.ghi ?? '-'} W/㎡ · 기온 {telemetry?.env?.ambientC ?? pvForecast?.current?.temperature ?? '-'} °C · 예측원: {pvForecast?.source === 'open-meteo' ? 'Open-Meteo 시간별 일사량' : '기본 모델'}</div>
            </Section>

            {sel && (
                <Section title={sel.name} right={<Button size="xs" tone="ghost" onClick={() => setSelected(null)}>닫기</Button>}>
                    <div className="gi-row">
                        <Badge color={HEALTH_COLORS[sel.health?.status || 'normal']} dot>{HEALTH_LABELS[sel.health?.status || 'normal']}</Badge>
                        <Badge color="#94a3b8">{fmt(sel.capacityKwp, 1)} kWp</Badge>
                        <Badge color="#94a3b8">{fmt(sel.moduleCount)}매</Badge>
                        <Badge color="#94a3b8">설치 {fmtDate(sel.installedAt)}</Badge>
                    </div>
                    <div className="gi-grid-3">
                        <Stat label="출력" value={fmt(liveByArray[sel.id]?.powerKw ?? 0, 1)} unit="kW" />
                        <Stat label="모듈 온도" value={fmt(liveByArray[sel.id]?.moduleTempC ?? 0, 1)} unit="°C" tone={(liveByArray[sel.id]?.moduleTempC || 0) > 60 ? 'warn' : 'default'} />
                        <Stat label="오늘 예상" value={fmt(fcByArray[sel.id]?.todayKwh ?? 0)} unit="kWh" sub={fcByArray[sel.id]?.lossKwh ? `손실 ${fmt(fcByArray[sel.id].lossKwh)} kWh` : ''} />
                    </div>
                    {fcByArray[sel.id]?.series?.length > 0 && <Sparkline data={fcByArray[sel.id].series.map((p) => p.kw)} width={370} height={40} color="#38bdf8" />}
                    <div className="gi-muted">핫스팟 {sel.health?.hotspotCount || 0}건 (심각 {sel.health?.critical || 0}) · 건전성 {Math.round((sel.health?.healthFactor || 1) * 100)}% · 최근 세척 {sel.lastCleaning} · 최근 열화상 {sel.lastThermalInspection || '없음'}</div>
                    <div className="gi-row">
                        <Button size="xs" onClick={() => { const f = facilities.find((x) => x.id === sel.facilityId); const ring = sel.geometry?.coordinates?.[0] || []; const c = ring.length ? ring.slice(0, -1).reduce((m, p) => [m[0] + p[0] / (ring.length - 1), m[1] + p[1] / (ring.length - 1)], [0, 0]) : null; if (f) flyTo({ lon: f.lon, lat: f.lat, height: 320, pitch: -60 }); else if (c) flyTo({ lon: c[0], lat: c[1], height: 260, pitch: -60 }); }}>위치로 이동</Button>
                        <Button size="xs" tone="ghost" onClick={async () => { if (window.confirm(`'${sel.name}' 어레이를 삭제할까요?`)) { await api.del(`/api/panelArrays/${sel.id}`); setSelected(null); refreshCollection('panelArrays'); } }}>삭제</Button>
                        <Button size="xs" onClick={() => createCleaningOrder(sel)}>세척 작업지시</Button>
                        <Button size="xs" tone="danger" onClick={() => createInspectionOrder(sel)}>현장 점검 지시</Button>
                    </div>
                </Section>
            )}

            <Section title="PV 어레이 등록 (정사영상 위에 그리기)">
                <div className="gi-row">
                    <Button tone={drawMode === 'panelArray' ? 'danger' : 'primary'} onClick={() => setDrawMode(drawMode === 'panelArray' ? null : 'panelArray')}>{drawMode === 'panelArray' ? '그리기 취소 (Esc)' : '지도에서 PV 어레이 그리기'}</Button>
                    <span className="gi-muted">좌클릭 점 추가 · 우클릭/더블클릭/Enter 완료</span>
                </div>
                <div className="gi-muted">면적·모듈 수(2.2 ㎡/550 W 기준)·설비용량은 자동 계산되며, 열화상 분석 시 어레이별 기준선으로 사용됩니다. 건물 폴리곤 안에 그리면 해당 시설에 자동 연결됩니다.</div>
            </Section>

            <Section title={`어레이 목록 (${panelArrays.length})`} right={
                <div className="gi-row">
                    {[['health', '건전성'], ['power', '출력'], ['capacity', '용량'], ['name', '이름']].map(([k, l]) => <Button key={k} size="xs" tone={sort === k ? 'primary' : 'ghost'} onClick={() => setSort(k)}>{l}</Button>)}
                </div>
            }>
                <Table
                    rows={rows}
                    activeKey={sel?.id}
                    onRowClick={(a) => setSelected({ type: 'panelArray', id: a.id })}
                    columns={[
                        { key: 'health', label: '상태', render: (a) => <Badge color={HEALTH_COLORS[a.health?.status || 'normal']} dot size="xs">{HEALTH_LABELS[a.health?.status || 'normal']}</Badge> },
                        { key: 'name', label: '어레이', render: (a) => <span title={a.name}>{a.name.replace(' 옥상 PV', '')}</span> },
                        { key: 'capacityKwp', label: 'kWp', align: 'right', render: (a) => fmt(a.capacityKwp) },
                        { key: 'power', label: 'kW', align: 'right', render: (a) => <b>{fmt(liveByArray[a.id]?.powerKw ?? 0)}</b> },
                        { key: 'eff', label: '효율', render: (a) => <Bar value={liveByArray[a.id]?.efficiency || 0} max={100} color={HEALTH_COLORS[a.health?.status || 'normal']} height={5} label={`${liveByArray[a.id]?.efficiency || 0}%`} /> },
                        { key: 'temp', label: '°C', align: 'right', render: (a) => liveByArray[a.id]?.moduleTempC ?? '-' },
                        { key: 'hs', label: '핫스팟', align: 'right', render: (a) => a.health?.hotspotCount || 0 },
                    ]}
                />
            </Section>

            <Section title="작업지시 / 유지보수" right={<span>{workOrders.filter((w) => w.status === 'open').length}건 진행</span>}>
                <div className="gi-list">
                    {workOrders.filter((w) => w.status !== 'done').slice(0, 6).map((w) => (
                        <div key={w.id} className="gi-list-item">
                            <Badge color={w.priority === 'high' ? '#ef4444' : w.priority === 'medium' ? '#f59e0b' : '#38bdf8'}>{w.priority === 'high' ? '긴급' : w.priority === 'medium' ? '보통' : '낮음'}</Badge>
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{w.title}</div>
                                <div className="gi-list-sub">{w.assignee} · 기한 {w.dueDate}</div>
                            </div>
                            <Button size="xs" tone="success" onClick={async () => { await api.put(`/api/workOrders/${w.id}`, { status: 'done', doneAt: new Date().toISOString() }); refreshCollection('workOrders'); }}>완료</Button>
                        </div>
                    ))}
                    {!workOrders.some((w) => w.status !== 'done') && <div className="gi-empty">진행 중인 작업지시 없음</div>}
                </div>
                <div className="gi-muted">세척 90일 경과: {panelArrays.filter((a) => !a.lastCleaning || Date.now() - new Date(a.lastCleaning).getTime() > 90 * 86400000).length}개 어레이</div>
            </Section>
        </>
    );
}
