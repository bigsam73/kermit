// 드론 운용: 스테이션 상태 · 임무 일정 · 촬영 사진 인덱스
import React, { useMemo, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Stat, Badge, Button, Field, Input, Select, Table, fmt, fmtTime } from '../components/ui';
import { DOCK_STATE_LABELS, MISSION_TYPE_LABELS } from '../constants';

export default function DroneView() {
    const docks = useIndustrialStore((s) => s.docks);
    const missions = useIndustrialStore((s) => s.missions);
    const photos = useIndustrialStore((s) => s.photos);
    const datasets = useIndustrialStore((s) => s.datasets);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const weather = useIndustrialStore((s) => s.weather);
    const panelArrays = useIndustrialStore((s) => s.panelArrays);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const jobs = useIndustrialStore((s) => s.jobs);
    const [tab, setTab] = useState('ops');
    const [form, setForm] = useState({ name: '', type: 'thermal-patrol', dockId: docks[0]?.id || '', scheduledAt: '', altitudeM: 60, repeat: '' });
    const [photoKind, setPhotoKind] = useState('all');

    const liveDocks = telemetry?.docks || [];
    const photoSets = datasets.filter((d) => d.type === 'photos');
    const photoRows = useMemo(() => photos.filter((p) => photoKind === 'all' || p.kind === photoKind).sort((a, b) => b.takenAt.localeCompare(a.takenAt)), [photos, photoKind]);
    const indexJob = jobs.find((j) => j.type === 'photo-index' && (j.status === 'running' || j.status === 'queued'));

    const createMission = async () => {
        if (!form.name) return;
        await api.post('/api/missions', { ...form, siteId: activeSiteId, status: 'scheduled', scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : new Date(Date.now() + 3600000).toISOString(), targets: form.type === 'thermal-patrol' ? panelArrays.map((a) => a.id) : [], sensor: form.type === 'thermal-patrol' ? 'thermal+rgb' : 'rgb' });
        setForm({ ...form, name: '', scheduledAt: '' });
        refreshCollection('missions');
    };
    const setStatus = async (m, status) => {
        await api.put(`/api/missions/${m.id}`, { status, ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {}) });
        refreshCollection('missions');
    };

    return (
        <>
            <div className="gi-row">
                {[['ops', '스테이션'], ['missions', `임무 ${missions.length}`], ['photos', `사진 ${photos.length}`]].map(([k, l]) => <Button key={k} tone={tab === k ? 'primary' : 'ghost'} onClick={() => setTab(k)}>{l}</Button>)}
            </div>

            {tab === 'ops' && (
                <>
                    <Section title="비행 조건" right={<Badge color={weather?.droneFlightOk === false ? '#ef4444' : '#22c55e'} dot>{weather?.droneFlightOk === false ? '비행 제한' : '비행 가능'}</Badge>}>
                        <div className="gi-grid-3">
                            <Stat label="풍속/돌풍" value={`${fmt(weather?.current?.wind_speed_10m, 1)}/${fmt(weather?.current?.wind_gusts_10m, 1)}`} unit="m/s" />
                            <Stat label="강수" value={fmt(weather?.current?.precipitation, 1)} unit="mm" />
                            <Stat label="시정/날씨" value={weather?.description || '-'} />
                        </div>
                        <div className="gi-muted">자동 임무는 돌풍 12 m/s 이상, 강수 0.5 mm 이상, 안개·뇌우 시 보류됩니다.</div>
                    </Section>
                    {docks.map((d) => {
                        const live = liveDocks.find((x) => x.dockId === d.id);
                        return (
                            <Section key={d.id} title={d.name} right={<Badge color={live?.state === 'IN_MISSION' ? '#38bdf8' : live?.state === 'CHARGING' ? '#f59e0b' : '#22c55e'} dot>{DOCK_STATE_LABELS[live?.state] || '대기'}</Badge>}>
                                <div className="gi-grid-4">
                                    <Stat label="배터리" value={live?.battery ?? '-'} unit="%" tone={(live?.battery || 100) < 30 ? 'warn' : 'ok'} />
                                    <Stat label="풍속" value={live?.windMs ?? '-'} unit="m/s" />
                                    <Stat label="도크 온도" value={live?.internalTempC ?? '-'} unit="°C" />
                                    <Stat label="통신" value={live?.online === false ? '단절' : '정상'} tone="ok" />
                                </div>
                                <div className="gi-muted">{d.model} · 설치 {d.installedAt}</div>
                                <div className="gi-row">
                                    <Button size="xs" onClick={() => { setSelected({ type: 'dock', id: d.id }); flyTo({ lon: d.lon, lat: d.lat, height: 220, pitch: -55 }); }}>위치</Button>
                                    <Button size="xs" onClick={() => setTab('missions')}>임무 예약</Button>
                                    <Button size="xs" tone="danger" onClick={() => alert('DJI FlightHub 2 / Dock API 연동 후 사용 가능합니다 (설정 > 연동).')}>긴급 이륙</Button>
                                </div>
                            </Section>
                        );
                    })}
                    {!docks.length && <div className="gi-empty">등록된 드론 스테이션이 없습니다. 설정에서 추가하세요.</div>}
                </>
            )}

            {tab === 'missions' && (
                <>
                    <Section title="임무 예약">
                        <Field label="임무명"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 3블록 옥상 PV 열화상 점검" /></Field>
                        <div className="gi-grid-2">
                            <Field label="유형"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={Object.entries(MISSION_TYPE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                            <Field label="스테이션"><Select value={form.dockId} onChange={(v) => setForm({ ...form, dockId: v })} options={docks.map((d) => ({ value: d.id, label: d.name }))} /></Field>
                            <Field label="시작 시각"><Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></Field>
                            <Field label="고도 (m)"><Input type="number" value={form.altitudeM} onChange={(e) => setForm({ ...form, altitudeM: Number(e.target.value) })} /></Field>
                        </div>
                        <Field label="반복"><Input value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} placeholder="예: daily 13:00 / weekly" /></Field>
                        <Button tone="primary" onClick={createMission} disabled={!form.name}>예약</Button>
                    </Section>
                    <Table
                        rows={[...missions].sort((a, b) => (a.status === b.status ? b.scheduledAt.localeCompare(a.scheduledAt) : a.status === 'scheduled' ? -1 : 1))}
                        columns={[
                            { key: 'status', label: '상태', render: (m) => <Badge size="xs" color={m.status === 'scheduled' ? '#38bdf8' : m.status === 'running' ? '#f59e0b' : m.status === 'completed' ? '#22c55e' : '#94a3b8'}>{{ scheduled: '예약', running: '진행', completed: '완료', cancelled: '취소' }[m.status] || m.status}</Badge> },
                            { key: 'name', label: '임무', render: (m) => <span title={m.name}>{m.name}</span> },
                            { key: 'type', label: '유형', render: (m) => MISSION_TYPE_LABELS[m.type] || m.type },
                            { key: 'scheduledAt', label: '시각', render: (m) => fmtTime(m.scheduledAt) },
                            { key: 'alt', label: '고도', align: 'right', render: (m) => `${m.altitudeM} m` },
                            { key: 'act', label: '', render: (m) => m.status === 'scheduled' ? <span className="gi-row"><Button size="xs" onClick={() => setStatus(m, 'completed')}>완료</Button><Button size="xs" tone="ghost" onClick={() => setStatus(m, 'cancelled')}>취소</Button></span> : (m.photos ? `${m.photos}장` : '') },
                        ]}
                    />
                </>
            )}

            {tab === 'photos' && (
                <>
                    <Section title="촬영 원본 데이터셋">
                        {photoSets.map((ds) => (
                            <div key={ds.id} className="gi-between">
                                <div className="min-w-0"><div className="gi-list-title">{ds.name}</div><div className="gi-list-sub">{ds.sourcePath} · {ds.photoCount ? `${fmt(ds.photoCount)}장 (GPS ${fmt(ds.photoWithGps)})` : '미인덱싱'}</div></div>
                                <Button size="xs" disabled={Boolean(indexJob)} onClick={async () => { await api.post(`/api/datasets/${ds.id}/index-photos`, { limit: 1500 }); refreshCollection('photos'); refreshCollection('datasets'); }}>{indexJob ? `인덱싱 ${indexJob.progress}%` : '인덱싱'}</Button>
                            </div>
                        ))}
                        {!photoSets.length && <div className="gi-muted">영상자료 메뉴에서 '촬영 원본 사진' 유형으로 폴더를 등록하면 EXIF GPS 기반으로 지도에 표시됩니다.</div>}
                    </Section>
                    <div className="gi-row">
                        {[['all', '전체'], ['thermal', '열화상'], ['visible', '가시광'], ['wide', '광각']].map(([k, l]) => <Button key={k} size="xs" tone={photoKind === k ? 'primary' : 'ghost'} onClick={() => setPhotoKind(k)}>{l}</Button>)}
                        <span className="gi-muted">{photoRows.length}장</span>
                    </div>
                    <div className="gi-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {photoRows.slice(0, 60).map((p) => (
                            <div key={p.id} className="is-clickable" style={{ cursor: 'pointer' }} onClick={() => { setSelected({ type: 'photo', id: p.id }); if (p.lat != null) flyTo({ lon: p.lon, lat: p.lat, height: 200, pitch: -70 }); }}>
                                {p.thumbUrl ? <img src={api.url(p.thumbUrl)} alt={p.name} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 4, border: `1px solid ${p.kind === 'thermal' ? '#f97316' : 'rgba(255,255,255,0.1)'}` }} loading="lazy" /> : <div className="gi-spark-empty" style={{ aspectRatio: '4/3' }}>{p.name}</div>}
                                <div className="gi-muted" style={{ fontSize: 9.5, marginTop: 2 }}>{fmtTime(p.takenAt)} {p.lat == null ? '· GPS 없음' : ''}</div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}
