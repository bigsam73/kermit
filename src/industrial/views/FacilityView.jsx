// 시설·입주기업: 필지/건물 목록, 검색·필터, 상세, 편집
import React, { useMemo, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Stat, Badge, Button, Input, Select, Table, Field, fmt } from '../components/ui';
import { FACILITY_COLORS, FACILITY_LABELS } from '../constants';

const STATUS_LABELS = { operating: '가동', maintenance: '정비', vacant: '공실', closed: '휴업' };

export default function FacilityView() {
    const facilities = useIndustrialStore((s) => s.facilities);
    const panelArrays = useIndustrialStore((s) => s.panelArrays);
    const selected = useIndustrialStore((s) => s.selected);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const drawMode = useIndustrialStore((s) => s.drawMode);
    const setDrawMode = useIndustrialStore((s) => s.setDrawMode);
    const [q, setQ] = useState('');
    const [type, setType] = useState('all');
    const [edit, setEdit] = useState(null);

    const rows = useMemo(() => facilities
        .filter((f) => type === 'all' || f.type === type)
        .filter((f) => !q || `${f.name} ${f.company || ''} ${f.lotNo}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.lotNo.localeCompare(b.lotNo)), [facilities, q, type]);
    const sel = selected?.type === 'facility' ? facilities.find((f) => f.id === selected.id) : null;
    const pvOf = (f) => panelArrays.filter((a) => a.facilityId === f.id);

    const save = async () => {
        await api.put(`/api/facilities/${edit.id}`, edit);
        setEdit(null);
        refreshCollection('facilities');
    };

    return (
        <>
            <div className="gi-grid-4">
                <Stat label="시설" value={facilities.length} />
                <Stat label="가동" value={facilities.filter((f) => f.status === 'operating').length} tone="ok" />
                <Stat label="공실" value={facilities.filter((f) => f.type === 'vacant').length} />
                <Stat label="고위험" value={facilities.filter((f) => (f.riskScore || 0) >= 60).length} tone="warn" />
            </div>
            <div className="gi-row">
                <Input placeholder="기업명 · 시설명 · 필지 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
                <Select value={type} onChange={setType} options={[{ value: 'all', label: '전체 유형' }, ...Object.entries(FACILITY_LABELS).map(([value, label]) => ({ value, label }))]} style={{ width: 120 }} />
            </div>
            <div className="gi-legend">
                {Object.entries(FACILITY_LABELS).map(([k, l]) => <span key={k}><i style={{ background: FACILITY_COLORS[k] }} />{l}</span>)}
            </div>
            <div className="gi-row">
                <Button tone={drawMode === 'facility' ? 'danger' : 'primary'} size="xs" onClick={() => setDrawMode(drawMode === 'facility' ? null : 'facility')}>{drawMode === 'facility' ? '그리기 취소 (Esc)' : '지도에서 시설(건물) 그리기'}</Button>
                <span className="gi-muted">좌클릭 점 추가 · 우클릭/Enter 완료 · 그린 뒤 "편집"으로 속성 입력</span>
            </div>

            {sel && !edit && (
                <Section title={sel.name} right={<div className="gi-row"><Button size="xs" onClick={() => setEdit({ ...sel })}>편집</Button><Button size="xs" tone="ghost" onClick={() => setSelected(null)}>닫기</Button></div>}>
                    <div className="gi-row">
                        <Badge color={FACILITY_COLORS[sel.type]}>{FACILITY_LABELS[sel.type]}</Badge>
                        <Badge color={sel.status === 'operating' ? '#22c55e' : '#f59e0b'} dot>{STATUS_LABELS[sel.status] || sel.status}</Badge>
                        <Badge color={(sel.riskScore || 0) >= 60 ? '#ef4444' : '#94a3b8'}>위험도 {sel.riskScore}</Badge>
                    </div>
                    <div className="gi-grid-3">
                        <Stat label="지붕 면적" value={fmt(sel.roofAreaSqm)} unit="㎡" />
                        <Stat label="상시 인원" value={fmt(sel.employees)} unit="명" />
                        <Stat label="월 전력" value={fmt(sel.energyKwhMonth / 1000, 1)} unit="MWh" />
                    </div>
                    <div className="gi-muted">필지 {sel.lotNo} · {sel.floors}층 · 지붕 {sel.roofType || '-'}{sel.buildingUse ? ` · 용도 ${sel.buildingUse}` : ''} · 유해요인 {sel.hazard} · 최근 점검 {sel.lastInspection}</div>
                    <div className="gi-muted">태양광: {pvOf(sel).length ? `${pvOf(sel).length}개 어레이 · ${fmt(pvOf(sel).reduce((s, a) => s + a.capacityKwp, 0))} kWp` : `미설치 (잠재 ${fmt((sel.roofAreaSqm * 0.6 * 0.78) / 2.2 * 0.55)} kWp 설치 가능)`}</div>
                    <div className="gi-row">
                        <Button size="xs" onClick={() => flyTo({ lon: sel.lon, lat: sel.lat, height: 320, pitch: -55 })}>위치로 이동</Button>
                        <Button size="xs" tone="ghost" onClick={async () => { if (window.confirm(`'${sel.name}' 시설을 삭제할까요?`)) { await api.del(`/api/facilities/${sel.id}`); setSelected(null); refreshCollection('facilities'); } }}>삭제</Button>
                        {pvOf(sel).length > 0 && <Button size="xs" onClick={() => setSelected({ type: 'panelArray', id: pvOf(sel)[0].id })}>PV 상세</Button>}
                    </div>
                </Section>
            )}

            {edit && (
                <Section title="시설 정보 편집" right={<Button size="xs" tone="ghost" onClick={() => setEdit(null)}>취소</Button>}>
                    <Field label="시설명"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                    <div className="gi-grid-2">
                        <Field label="입주기업"><Input value={edit.company || ''} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></Field>
                        <Field label="필지번호"><Input value={edit.lotNo} onChange={(e) => setEdit({ ...edit, lotNo: e.target.value })} /></Field>
                        <Field label="유형"><Select value={edit.type} onChange={(v) => setEdit({ ...edit, type: v, typeLabel: FACILITY_LABELS[v] })} options={Object.entries(FACILITY_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                        <Field label="상태"><Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                        <Field label="층수"><Input type="number" value={edit.floors} onChange={(e) => setEdit({ ...edit, floors: Number(e.target.value), heightM: Number(e.target.value) * (edit.type === 'office' ? 3.6 : 9) })} /></Field>
                        <Field label="상시 인원"><Input type="number" value={edit.employees} onChange={(e) => setEdit({ ...edit, employees: Number(e.target.value) })} /></Field>
                        <Field label="유해요인"><Input value={edit.hazard || ''} onChange={(e) => setEdit({ ...edit, hazard: e.target.value })} /></Field>
                        <Field label="위험도 (0-100)"><Input type="number" value={edit.riskScore} onChange={(e) => setEdit({ ...edit, riskScore: Number(e.target.value) })} /></Field>
                        <Field label="안전관리 연락처"><Input value={edit.contact || ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></Field>
                        <Field label="최근 점검일"><Input type="date" value={edit.lastInspection || ''} onChange={(e) => setEdit({ ...edit, lastInspection: e.target.value })} /></Field>
                    </div>
                    <Button tone="primary" onClick={save}>저장</Button>
                </Section>
            )}

            <Table
                rows={rows}
                activeKey={sel?.id}
                onRowClick={(f) => { setSelected({ type: 'facility', id: f.id }); }}
                columns={[
                    { key: 'lotNo', label: '필지', width: 60 },
                    { key: 'type', label: '유형', render: (f) => <Badge color={FACILITY_COLORS[f.type]} size="xs">{FACILITY_LABELS[f.type]}</Badge> },
                    { key: 'company', label: '기업 / 시설', render: (f) => f.company || f.name },
                    { key: 'status', label: '상태', render: (f) => STATUS_LABELS[f.status] || f.status },
                    { key: 'roofAreaSqm', label: '지붕㎡', align: 'right', render: (f) => fmt(f.roofAreaSqm) },
                    { key: 'pv', label: 'PV', align: 'right', render: (f) => (pvOf(f).length ? `${fmt(pvOf(f).reduce((s, a) => s + a.capacityKwp, 0))}` : '-') },
                    { key: 'riskScore', label: '위험', align: 'right', render: (f) => <span style={{ color: f.riskScore >= 60 ? '#f87171' : undefined }}>{f.riskScore}</span> },
                ]}
            />
        </>
    );
}
