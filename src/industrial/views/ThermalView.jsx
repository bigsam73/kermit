// 열화상 분석: 데이터셋 선택 → 임계값 설정 → 핫스팟 추출 → 목록/이동/처리
import React, { useMemo, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Badge, Button, Field, Input, Select, Stat, StackBar, Table, fmt, fmtTime } from '../components/ui';
import { SEVERITY_COLORS, SEVERITY_LABELS, THERMAL_PALETTES } from '../constants';

export default function ThermalView() {
    const datasets = useIndustrialStore((s) => s.datasets);
    const hotspots = useIndustrialStore((s) => s.hotspots);
    const inspections = useIndustrialStore((s) => s.inspections);
    const thermal = useIndustrialStore((s) => s.thermal);
    const setThermalOption = useIndustrialStore((s) => s.setThermalOption);
    const overlayState = useIndustrialStore((s) => s.overlayState);
    const setOverlay = useIndustrialStore((s) => s.setOverlay);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const refreshSummary = useIndustrialStore((s) => s.refreshSummary);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const highlightHotspotId = useIndustrialStore((s) => s.highlightHotspotId);
    const setHighlightHotspot = useIndustrialStore((s) => s.setHighlightHotspot);
    const loadError = useIndustrialStore((s) => s.loadError);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const thermalSets = datasets.filter((d) => d.type === 'thermal');
    const [datasetId, setDatasetId] = useState(thermalSets[0]?.id || '');
    const [filter, setFilter] = useState('all');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const ds = thermalSets.find((d) => d.id === datasetId) || thermalSets[0];

    const rows = useMemo(() => hotspots
        .filter((h) => !ds || h.datasetId === ds.id)
        .filter((h) => (filter === 'all' ? true : filter === 'pv' ? Boolean(h.arrayId) : filter === 'nonpv' ? !h.arrayId : h.severity === filter))
        .sort((a, b) => b.maxT - a.maxT), [hotspots, ds, filter]);

    const run = async () => {
        if (!ds) return;
        setBusy(true);
        setResult(null);
        try {
            const r = await api.post(`/api/datasets/${ds.id}/analyze-thermal`, { deltaThreshold: Number(thermal.deltaThreshold), absoluteThreshold: thermal.absoluteThreshold === '' ? null : Number(thermal.absoluteThreshold), nonPvDeltaThreshold: thermal.nonPvDeltaThreshold === '' || thermal.nonPvDeltaThreshold == null ? null : Number(thermal.nonPvDeltaThreshold), minPixels: 3, maxHotspots: 300 });
            setResult(r);
            await Promise.all([refreshCollection('hotspots'), refreshCollection('inspections'), refreshCollection('panelArrays'), refreshCollection('alerts'), refreshCollection('datasets')]);
            refreshSummary();
            setOverlay(ds.id, { visible: true });
        } catch (err) {
            setResult({ error: err.message });
        } finally {
            setBusy(false);
        }
    };

    const last = inspections.find((i) => !ds || i.datasetId === ds.id);
    const bySev = (k) => rows.filter((h) => h.severity === k).length;

    if (!thermalSets.length) {
        if (loadError) {
            return (
                <div className="gi-empty">
                    <div className="gi-error">서버에서 단지 데이터를 받지 못했습니다 ({loadError}).</div>
                    주소가 <b>http://localhost:3200/</b> 인지 확인하세요. 예전 개발 포트(5174)는 더 이상 사용하지 않습니다.<br />
                    <Button size="xs" tone="primary" onClick={() => window.location.assign(`${window.location.protocol}//${window.location.hostname}:3200/`)}>3200 포트로 이동</Button>
                </div>
            );
        }
        return (
            <div className="gi-empty">
                이 단지({activeSiteId})에 열화상 정사영상이 없습니다.<br />
                드론 열화상 매핑(DJI Terra/Pix4D) 결과 GeoTIFF(온도값 Float32 권장)를 영상자료 메뉴에서 '열화상 정사영상' 유형으로 등록하세요.
            </div>
        );
    }

    return (
        <>
            <Section title="분석 대상" right={ds?.lastAnalysisAt ? <span>최근 분석 {fmtTime(ds.lastAnalysisAt)}</span> : null}>
                <Select value={ds?.id || ''} onChange={setDatasetId} options={thermalSets.map((d) => ({ value: d.id, label: `${d.name}${d.isSynthetic ? ' [합성]' : ''}` }))} />
                {ds && (
                    <div className="gi-muted">
                        {ds.width ? `${fmt(ds.width)}×${fmt(ds.height)} px · ` : ''}{ds.gsd ? `GSD ${(ds.gsd * 100).toFixed(1)} cm · ` : ''}{ds.epsg ? `EPSG:${ds.epsg} · ` : ''}{ds.emissivity ? `방사율 ${ds.emissivity} · ` : ''}{ds.rawIsTemperature ? '온도값(°C) Float32' : '팔레트 영상'}
                    </div>
                )}
                <div className="gi-grid-3">
                    <Field label="PV ΔT (°C)" hint="어레이 중앙값 대비">
                        <Input type="number" step="1" value={thermal.deltaThreshold} onChange={(e) => setThermalOption({ deltaThreshold: e.target.value })} />
                    </Field>
                    <Field label="PV 외 ΔT (°C)" hint="영상 중앙값 대비 · 비우면 PV ΔT+20">
                        <Input type="number" step="1" value={thermal.nonPvDeltaThreshold ?? ''} onChange={(e) => setThermalOption({ nonPvDeltaThreshold: e.target.value })} placeholder="자동" />
                    </Field>
                    <Field label="절대 온도 (°C, 선택)" hint="둘 중 높은 값 적용">
                        <Input type="number" step="1" value={thermal.absoluteThreshold} onChange={(e) => setThermalOption({ absoluteThreshold: e.target.value })} placeholder="예: 85" />
                    </Field>
                </div>
                <div className="gi-muted">PV 어레이가 등록되지 않은 단지는 모두 "PV 외" 기준으로 판정됩니다. 태양광 메뉴에서 어레이를 그린 뒤 재분석하면 어레이별 기준선이 적용됩니다. 결과는 최고온도 순 상위 300건 저장, 지도에는 200건 표시됩니다.</div>
                <div className="gi-row">
                    <Button tone="primary" size="md" disabled={busy} onClick={run}>{busy ? '분석 중…' : '핫스팟 분석 실행'}</Button>
                    <span className={`toggle-switch ${overlayState[ds?.id]?.visible ? 'active' : ''}`} onClick={() => setOverlay(ds.id, { visible: !overlayState[ds.id]?.visible })} />
                    <span className="gi-muted">열화상 오버레이</span>
                </div>
                {result?.error && <div className="gi-error">{result.error}</div>}
                {result && !result.error && <div className="gi-muted">완료: 핫스팟 {result.hotspotCount}건{result.hotspotCount > 300 ? ' (상위 300건 저장)' : ''} · 배경 {result.background}°C · PV 외 임계 {result.threshold}°C</div>}
            </Section>

            <Section title="표시 옵션">
                {ds?.tilesUrl && (
                    <div className="gi-row">
                        <span className="gi-muted">오버레이 소스</span>
                        <Button size="xs" tone={(overlayState[ds.id]?.mode || 'tiles') === 'tiles' ? 'primary' : 'ghost'} onClick={() => setOverlay(ds.id, { mode: 'tiles' })}>Terra 팔레트 타일 (원해상도)</Button>
                        <Button size="xs" tone={overlayState[ds.id]?.mode === 'grid' ? 'primary' : 'ghost'} onClick={() => setOverlay(ds.id, { mode: 'grid' })}>온도 그리드 컬러맵</Button>
                    </div>
                )}
                <div className="gi-grid-3">
                    <Field label="팔레트"><Select value={thermal.palette} onChange={(v) => setThermalOption({ palette: v })} options={Object.keys(THERMAL_PALETTES).map((k) => ({ value: k, label: k }))} /></Field>
                    <Field label="최소 °C"><Input type="number" value={thermal.min ?? ''} placeholder="자동" onChange={(e) => setThermalOption({ min: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
                    <Field label="최대 °C"><Input type="number" value={thermal.max ?? ''} placeholder="자동" onChange={(e) => setThermalOption({ max: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
                </div>
                <div className="gi-row"><span className="gi-muted">투명도</span><input type="range" min="0.1" max="1" step="0.05" className="gi-input" style={{ flex: 1 }} value={thermal.opacity} onChange={(e) => setThermalOption({ opacity: Number(e.target.value) })} /></div>
                {ds?.thermalStats && <div className="gi-muted">영상 통계: 최소 {ds.thermalStats.min}° · 중앙값 {ds.thermalStats.median}° · 평균 {ds.thermalStats.mean}° · 최대 {ds.thermalStats.max}°</div>}
            </Section>

            <StackBar items={['critical', 'high', 'medium', 'low'].map((k) => ({ label: SEVERITY_LABELS[k], value: bySev(k), color: SEVERITY_COLORS[k] }))} />
            <div className="gi-grid-4">
                <Stat label="심각" value={bySev('critical')} tone="bad" onClick={() => setFilter('critical')} />
                <Stat label="높음" value={bySev('high')} tone="warn" onClick={() => setFilter('high')} />
                <Stat label="보통" value={bySev('medium')} onClick={() => setFilter('medium')} />
                <Stat label="PV / 기타" value={`${rows.filter((h) => h.arrayId).length}/${rows.filter((h) => !h.arrayId).length}`} onClick={() => setFilter('all')} />
            </div>

            <Section title={`핫스팟 목록 (${rows.length})`} right={
                <Select value={filter} onChange={setFilter} options={[{ value: 'all', label: '전체' }, { value: 'critical', label: '심각' }, { value: 'high', label: '높음' }, { value: 'medium', label: '보통' }, { value: 'pv', label: 'PV만' }, { value: 'nonpv', label: 'PV 외' }]} style={{ width: 96 }} />
            }>
                <Table
                    rows={rows}
                    activeKey={highlightHotspotId}
                    onRowClick={(h) => { setHighlightHotspot(h.id); setSelected({ type: 'hotspot', id: h.id }); flyTo({ lon: h.lon, lat: h.lat, height: 140, pitch: -70 }); }}
                    columns={[
                        { key: 'index', label: '#', width: 32 },
                        { key: 'severity', label: '등급', render: (h) => <Badge color={SEVERITY_COLORS[h.severity]} dot size="xs">{SEVERITY_LABELS[h.severity]}</Badge> },
                        { key: 'maxT', label: '최고°C', align: 'right', render: (h) => <b>{h.maxT}</b> },
                        { key: 'deltaT', label: 'ΔT', align: 'right', render: (h) => `+${h.deltaT}` },
                        { key: 'areaSqm', label: '㎡', align: 'right', render: (h) => fmt(h.areaSqm, 1) },
                        { key: 'arrayName', label: '위치', render: (h) => h.arrayName || <span className="gi-muted">PV 외</span> },
                        { key: 'status', label: '상태', render: (h) => h.status === 'resolved' ? '완료' : h.status === 'confirmed' ? '확인' : '-' },
                    ]}
                />
            </Section>

            {last && (
                <Section title="최근 분석 이력">
                    <div className="gi-list">
                        {inspections.filter((i) => !ds || i.datasetId === ds.id).slice(0, 4).map((i) => (
                            <div key={i.id} className="gi-list-item">
                                <div>
                                    <div className="gi-list-title">{fmtTime(i.createdAt)} · 핫스팟 {i.hotspotCount}건 (PV {i.pvHotspots})</div>
                                    <div className="gi-list-sub">ΔT {i.params?.deltaThreshold}° · 배경 {i.background}° · 임계 {i.threshold}° · 영상 최고 {i.stats?.max}°</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            <Section title="판정 기준 (IEC TS 62446-3 참고)">
                <div className="gi-muted" style={{ lineHeight: 1.6 }}>
                    정상 모듈(어레이 중앙값) 대비 ΔT ≥ 10°C 보통 · ≥ 20°C 높음 · ≥ 30°C 심각. 핫스팟이 셀 단위로 반복되면 바이패스 다이오드 결함, 스트링 전체가 고온이면 개방 회로, 패턴 없는 국소 고온은 오염·그늘 가능성.
                    PV 외 고온원은 공정 배기·전기설비 과열 점검 대상으로 분류됩니다.
                </div>
            </Section>
        </>
    );
}
