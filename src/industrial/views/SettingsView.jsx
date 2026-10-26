// 설정: 단지 관리 · 센서/스테이션 추가 · 시스템 상태 · 연동
import React, { useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Badge, Button, Field, Input, Select, fmt } from '../components/ui';

export default function SettingsView() {
    const sites = useIndustrialStore((s) => s.sites);
    const site = useIndustrialStore((s) => s.sites.find((x) => x.id === s.activeSiteId));
    const refreshSites = useIndustrialStore((s) => s.refreshSites);
    const setActiveSite = useIndustrialStore((s) => s.setActiveSite);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const systemStatus = useIndustrialStore((s) => s.systemStatus);
    const jobs = useIndustrialStore((s) => s.jobs);
    const [edit, setEdit] = useState(null);
    const [newSite, setNewSite] = useState(null);
    const [sensor, setSensor] = useState({ name: '', type: 'air', lon: '', lat: '' });
    const [dock, setDock] = useState({ name: '', model: 'DJI Dock 3 / Matrice 4TD', lon: '', lat: '' });

    const saveSite = async () => {
        await api.put(`/api/sites/${edit.id}`, { ...edit, lon: Number(edit.lon), lat: Number(edit.lat), cameraHeight: Number(edit.cameraHeight) || 2500, pvTargetKwp: Number(edit.pvTargetKwp) || 0 });
        setEdit(null);
        await refreshSites();
    };
    const createSite = async () => {
        const lon = Number(newSite.lon);
        const lat = Number(newSite.lat);
        const d = 0.006;
        const row = await api.post('/api/sites', { ...newSite, lon, lat, code: newSite.code || 'NEW', boundary: [[lon - d, lat - d * 0.7], [lon + d, lat - d * 0.7], [lon + d, lat + d * 0.7], [lon - d, lat + d * 0.7], [lon - d, lat - d * 0.7]], cameraHeight: 2500, type: newSite.type || 'general' });
        setNewSite(null);
        await refreshSites();
        setActiveSite(row.id);
    };
    const addSensor = async () => {
        await api.post('/api/sensors', { ...sensor, siteId: site.id, lon: Number(sensor.lon) || site.lon, lat: Number(sensor.lat) || site.lat, baseline: {}, installedAt: new Date().toISOString().slice(0, 10) });
        setSensor({ name: '', type: 'air', lon: '', lat: '' });
        refreshCollection('sensors');
    };
    const addDock = async () => {
        await api.post('/api/docks', { ...dock, siteId: site.id, lon: Number(dock.lon) || site.lon, lat: Number(dock.lat) || site.lat, installedAt: new Date().toISOString().slice(0, 10), simulate: true });
        setDock({ ...dock, name: '', lon: '', lat: '' });
        refreshCollection('docks');
    };

    return (
        <>
            <Section title="산업단지 목록" right={<Button size="xs" onClick={() => setNewSite({ name: '', region: '', lon: '', lat: '', code: '', type: 'general' })}>+ 단지 추가</Button>}>
                <div className="gi-list">
                    {sites.map((s) => (
                        <div key={s.id} className={`gi-list-item ${s.id === site?.id ? 'is-active' : ''}`}>
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{s.name}</div>
                                <div className="gi-list-sub">{s.region} · {s.lat?.toFixed(4)}, {s.lon?.toFixed(4)} · {fmt(s.areaHa)} ha</div>
                            </div>
                            <Button size="xs" onClick={() => setActiveSite(s.id)}>선택</Button>
                            <Button size="xs" onClick={() => setEdit({ ...s })}>편집</Button>
                        </div>
                    ))}
                </div>
            </Section>

            {(edit || newSite) && (
                <Section title={edit ? '단지 편집' : '단지 추가'} right={<Button size="xs" tone="ghost" onClick={() => { setEdit(null); setNewSite(null); }}>취소</Button>}>
                    {(() => {
                        const v = edit || newSite;
                        const set = (patch) => (edit ? setEdit({ ...edit, ...patch }) : setNewSite({ ...newSite, ...patch }));
                        return (
                            <>
                                <Field label="단지명"><Input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
                                <div className="gi-grid-2">
                                    <Field label="코드"><Input value={v.code || ''} onChange={(e) => set({ code: e.target.value })} /></Field>
                                    <Field label="지역"><Input value={v.region || ''} onChange={(e) => set({ region: e.target.value })} /></Field>
                                    <Field label="경도"><Input type="number" step="0.0001" value={v.lon} onChange={(e) => set({ lon: e.target.value })} /></Field>
                                    <Field label="위도"><Input type="number" step="0.0001" value={v.lat} onChange={(e) => set({ lat: e.target.value })} /></Field>
                                    <Field label="유형"><Select value={v.type || 'general'} onChange={(t) => set({ type: t })} options={[{ value: 'national', label: '국가산단' }, { value: 'general', label: '일반산단' }, { value: 'agro', label: '농공단지' }, { value: 'testbed', label: '실증 테스트베드' }]} /></Field>
                                    <Field label="면적 (ha)"><Input type="number" value={v.areaHa || ''} onChange={(e) => set({ areaHa: Number(e.target.value) })} /></Field>
                                    <Field label="입주기업 수"><Input type="number" value={v.companies || ''} onChange={(e) => set({ companies: Number(e.target.value) })} /></Field>
                                    <Field label="PV 목표 (kWp)"><Input type="number" value={v.pvTargetKwp || ''} onChange={(e) => set({ pvTargetKwp: Number(e.target.value) })} /></Field>
                                    {edit && <Field label="카메라 높이 (m)"><Input type="number" value={v.cameraHeight || 2500} onChange={(e) => set({ cameraHeight: Number(e.target.value) })} /></Field>}
                                </div>
                                <Field label="설명"><Input value={v.description || ''} onChange={(e) => set({ description: e.target.value })} /></Field>
                                <Button tone="primary" onClick={edit ? saveSite : createSite} disabled={!v.name || !v.lon || !v.lat}>{edit ? '저장' : '추가'}</Button>
                            </>
                        );
                    })()}
                </Section>
            )}

            {site && (
                <div className="gi-grid-2">
                    <Section title="센서 추가">
                        <Field label="이름"><Input value={sensor.name} onChange={(e) => setSensor({ ...sensor, name: e.target.value })} /></Field>
                        <Field label="유형"><Select value={sensor.type} onChange={(v) => setSensor({ ...sensor, type: v })} options={[{ value: 'air', label: '대기질' }, { value: 'noise', label: '소음' }, { value: 'voc', label: 'VOC/악취' }, { value: 'weather', label: '기상' }]} /></Field>
                        <Field label="경도,위도 (비우면 단지 중심)"><div className="gi-row"><Input placeholder="경도" value={sensor.lon} onChange={(e) => setSensor({ ...sensor, lon: e.target.value })} /><Input placeholder="위도" value={sensor.lat} onChange={(e) => setSensor({ ...sensor, lat: e.target.value })} /></div></Field>
                        <Button onClick={addSensor} disabled={!sensor.name}>추가</Button>
                    </Section>
                    <Section title="드론 스테이션 추가">
                        <Field label="이름"><Input value={dock.name} onChange={(e) => setDock({ ...dock, name: e.target.value })} /></Field>
                        <Field label="기종"><Input value={dock.model} onChange={(e) => setDock({ ...dock, model: e.target.value })} /></Field>
                        <Field label="경도,위도"><div className="gi-row"><Input placeholder="경도" value={dock.lon} onChange={(e) => setDock({ ...dock, lon: e.target.value })} /><Input placeholder="위도" value={dock.lat} onChange={(e) => setDock({ ...dock, lat: e.target.value })} /></div></Field>
                        <Button onClick={addDock} disabled={!dock.name}>추가</Button>
                    </Section>
                </div>
            )}

            <Section title="시스템 상태">
                <div className="gi-row">
                    <Badge color={systemStatus?.gdal?.available ? '#22c55e' : '#ef4444'} dot>GDAL {systemStatus?.gdal?.available ? '사용 가능' : '없음'}</Badge>
                    <Badge color="#94a3b8">Node {systemStatus?.node}</Badge>
                    <Badge color="#94a3b8">가동 {fmt((systemStatus?.uptimeSec || 0) / 60)}분</Badge>
                </div>
                <div className="gi-muted">데이터 폴더: {systemStatus?.dataDir}</div>
                <div className="gi-muted">GDAL: {systemStatus?.gdal?.dir || '-'} (타일 CLI {systemStatus?.gdal?.tileCli ? '지원' : '미지원'})</div>
                <div className="gi-list" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {jobs.slice(0, 8).map((j) => (
                        <div key={j.id} className="gi-between gi-muted"><span>{j.type} · {j.datasetId || ''}</span><span>{j.status} {j.progress}%{j.error ? ` · ${j.error}` : ''}</span></div>
                    ))}
                </div>
                <div className="gi-row">
                    <Button size="xs" tone="danger" onClick={async () => { if (window.confirm('모든 데이터를 데모 시드로 초기화할까요?')) { await api.post('/api/system/reseed', {}); window.location.reload(); } }}>데모 데이터 재생성</Button>
                </div>
            </Section>

            <Section title="외부 연동 (준비)">
                <div className="gi-list">
                    {[
                        ['DJI FlightHub 2 / Dock API', '임무 자동 실행 · 사진 자동 수집 · 실시간 영상. 서버 .env에 FH2_BASE_URL, FH2_TOKEN 설정 후 활성화.'],
                        ['인버터 모니터링 (Modbus/RS485, 제조사 API)', '실제 발전량·스트링 전류로 시뮬레이션 대체. telemetry 메시지 형식 동일.'],
                        ['IoT 환경 센서 (MQTT)', '대기질·소음·VOC 게이트웨이 구독.'],
                        ['Copernicus / Sentinel Hub', '위성영상 자동 수집 (API 키 필요).'],
                        ['VWorld 배경지도 / 항공영상', '국토부 VWorld API 키 설정 시 한국 고해상 항공영상 배경 사용.'],
                        ['카카오맵 위성 타일', 'Leaflet 등 2D 보조지도용 프록시 (골프장 플랫폼과 동일 방식).'],
                    ].map(([t, d]) => <div key={t} className="gi-list-item"><div><div className="gi-list-title">{t}</div><div className="gi-list-sub">{d}</div></div></div>)}
                </div>
            </Section>
        </>
    );
}
