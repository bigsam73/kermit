// 상호 기입: 지적도 필지를 클릭해 상호·회사정보를 기입 (여러 필지 한 번에 가능)
import React, { useEffect, useMemo, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Stat, Badge, Button, Input, Select, Table, Field, Toggle, fmt } from '../components/ui';
import { FACILITY_COLORS, FACILITY_LABELS } from '../constants';
import { downloadText } from '../lib/csv';

const EMPTY = { company: '', ceo: '', category: '', industry: '', phone: '', memo: '' };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export default function LotsView() {
    const siteId = useIndustrialStore((s) => s.activeSiteId);
    const parcels = useIndustrialStore((s) => s.parcels);
    const lotPick = useIndustrialStore((s) => s.lotPick);
    const setLotPick = useIndustrialStore((s) => s.setLotPick);
    const setParcelUi = useIndustrialStore((s) => s.setParcelUi);
    const parcelUi = useIndustrialStore((s) => s.parcelUi);
    const selected = useIndustrialStore((s) => s.selected);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const setMenu = useIndustrialStore((s) => s.setMenu);

    const [form, setForm] = useState(EMPTY);
    const [last, setLast] = useState(null);
    const [msg, setMsg] = useState(null);
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState('');

    // 메뉴가 열려 있는 동안 지적도 표시 + 클릭 선택 모드 ON
    useEffect(() => {
        const wasOn = useIndustrialStore.getState().parcelUi.cadastral;
        setParcelUi({ cadastral: true });
        setLotPick({ active: true, picked: [], hint: null });
        return () => {
            setLotPick({ active: false, picked: [], hint: null });
            if (!wasOn) setParcelUi({ cadastral: false });
        };
    }, [setParcelUi, setLotPick]);

    const byPnu = useMemo(() => new Map(parcels.filter((p) => p.pnu).map((p) => [p.pnu, p])), [parcels]);
    const picked = lotPick.picked;
    const existing = picked.map((l) => byPnu.get(l.pnu)).filter(Boolean);

    // 필지 하나를 골랐는데 이미 기입돼 있으면 폼에 채움
    useEffect(() => {
        if (picked.length === 1 && existing[0]) {
            const p = existing[0];
            setForm({ company: p.company || '', ceo: p.ceo || '', category: p.categoryAuto ? '' : p.category || '', industry: p.industry || '', phone: p.phone || '', memo: p.memo || '' });
        } else if (picked.length === 0) setForm(EMPTY);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [picked.map((l) => l.pnu).join(',')]);

    const companies = useMemo(() => [...new Set(parcels.map((p) => p.company).filter(Boolean))].sort(), [parcels]);
    const filled = parcels.filter((p) => p.company && p.geometry);
    const totalArea = picked.reduce((s, l) => s + approxArea(l.polygon[0]), 0);

    const save = async () => {
        if (!picked.length) return;
        if (!form.company.trim()) { setMsg({ tone: 'danger', text: '상호를 입력하세요' }); return; }
        setBusy(true);
        setMsg(null);
        try {
            const lots = picked.map((l) => ({ pnu: l.pnu, jibun: l.jibun, addr: l.addr, polygon: l.polygon, lon: l.lon, lat: l.lat }));
            const r = await api.post('/api/parcels/lots', { siteId, lots, info: form });
            await refreshCollection('parcels');
            setLast(form);
            setMsg({ tone: 'ok', text: `'${form.company}' → ${r.count}개 필지 기입 완료${r.enrich?.withBuildings ? ` · 건축물대장: ${r.enrich.usageName || ''} ${r.enrich.floors ? r.enrich.floors + '층' : ''} 자동 채움` : r.enrich?.error ? ` · 건축물 조회 실패(${r.enrich.error})` : ' · 건축물 정보 없음'}` });
            setLotPick({ picked: [], hint: null });
        } catch (err) {
            setMsg({ tone: 'danger', text: err.message });
        } finally {
            setBusy(false);
        }
    };
    const clearInfo = async () => {
        if (!existing.length || !window.confirm(`선택한 필지 ${existing.length}건의 기입 정보를 삭제할까요?`)) return;
        for (const p of existing) await api.del(`/api/parcels/${p.id}`);
        await refreshCollection('parcels');
        setLotPick({ picked: [], hint: null });
        setMsg({ tone: 'ok', text: '기입 정보를 삭제했습니다' });
    };
    const refreshBuildings = async () => {
        setBusy(true);
        setMsg({ tone: 'warn', text: '건축물대장 조회 중…' });
        try {
            const ids = filled.map((p) => p.id);
            let wb = 0;
            for (let k = 0; k < ids.length; k += 60) wb += (await api.post('/api/parcels/enrich', { siteId, ids: ids.slice(k, k + 60) })).withBuildings;
            await refreshCollection('parcels');
            setMsg({ tone: 'ok', text: `건축물 정보 ${wb}/${ids.length}건 갱신` });
        } catch (err) {
            setMsg({ tone: 'danger', text: err.message });
        } finally {
            setBusy(false);
        }
    };
    const exportCsv = () => {
        const head = ['상호', '대표자', '업종분류', '세부업종', '연락처', '주소', '지번', 'PNU', '면적(㎡)', '지상층수', '건축물용도', '건축면적(㎡)', '연면적(㎡)', '사용승인', '비고'];
        const rows = filled.map((p) => [p.company, p.ceo, FACILITY_LABELS[p.category] || '', p.industry, p.phone, p.address, p.lotNo, p.pnu, p.areaSqm, p.floors, p.usageName, p.bldArchAreaSqm, p.bldTotalAreaSqm, p.approvedFirst, p.memo].map(csvCell).join(','));
        downloadText(`상호기입현황_${siteId}.csv`, [head.map(csvCell).join(','), ...rows].join('\n'));
    };

    const rows = useMemo(() => filled.filter((p) => !q || `${p.company} ${p.address} ${p.ceo || ''} ${p.industry || ''} ${p.phone || ''}`.toLowerCase().includes(q.toLowerCase())), [filled, q]);
    const sel = selected?.type === 'parcel' ? parcels.find((p) => p.id === selected.id) : null;

    return (
        <>
            <Section title="① 지적도에서 필지 선택" right={<Toggle checked={lotPick.active} onChange={(v) => setLotPick({ active: v })} label="클릭 선택" />}>
                <div className="gi-muted">
                    지도를 <b>약 1 km 이하로 확대(위에서 내려다볼수록 정확)</b>하면 노란 지적 경계가 나타납니다. 필지를 <b>클릭</b>하면 선택되고, 한 업체가 여러 필지를 쓰면 <b>Shift(또는 Ctrl)+클릭</b>으로 추가 선택하세요.
                </div>
                {lotPick.hint && <div className="gi-error">{lotPick.hint}</div>}
                {picked.length > 0 ? (
                    <div>
                        <div className="gi-row" style={{ justifyContent: 'space-between' }}>
                            <b>{picked.length}개 필지 선택 · 약 {fmt(totalArea)} ㎡</b>
                            <Button size="xs" tone="ghost" onClick={() => setLotPick({ picked: [] })}>선택 해제</Button>
                        </div>
                        {picked.map((l) => (
                            <div key={l.key} className="gi-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <span style={{ flex: 1 }}>{l.addr || l.jibun}{byPnu.get(l.pnu)?.floors ? ` · ${byPnu.get(l.pnu).floors}층 ${byPnu.get(l.pnu).usageName || ''}` : ''}</span>
                                {byPnu.get(l.pnu) && <Badge color="#22c55e" size="xs">{byPnu.get(l.pnu).company}</Badge>}
                                <a href="#" onClick={(e) => { e.preventDefault(); setLotPick({ picked: picked.filter((x) => x.key !== l.key) }); }}>✕</a>
                            </div>
                        ))}
                    </div>
                ) : <div className="gi-muted">선택된 필지 없음 — 지도에서 필지를 클릭하세요.</div>}
            </Section>

            <Section title="② 상호·회사정보 입력">
                <datalist id="gi-company-list">{companies.map((c) => <option key={c} value={c} />)}</datalist>
                <Field label="상호(회사명) *" hint="이미 입력한 상호는 자동완성됩니다"><Input list="gi-company-list" value={form.company} disabled={!picked.length} onChange={(e) => setForm({ ...form, company: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} /></Field>
                <div className="gi-grid-2">
                    <Field label="대표자"><Input value={form.ceo} disabled={!picked.length} onChange={(e) => setForm({ ...form, ceo: e.target.value })} /></Field>
                    <Field label="연락처"><Input value={form.phone} disabled={!picked.length} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                    <Field label="업종 분류" hint="비워두면 건축물대장 주용도로 자동 분류"><Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={[{ value: '', label: '자동 (건축물대장 용도)' }, ...Object.entries(FACILITY_LABELS).map(([value, label]) => ({ value, label }))]} disabled={!picked.length} /></Field>
                    <Field label="세부 업종"><Input placeholder="예: 금속가공, 식품" value={form.industry} disabled={!picked.length} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
                </div>
                <Field label="비고"><Input value={form.memo} disabled={!picked.length} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
                <div className="gi-row">
                    <Button tone="primary" size="md" disabled={!picked.length || busy} onClick={save}>{busy ? '저장 중…' : existing.length ? '수정 저장 (Enter)' : '기입 저장 (Enter)'}</Button>
                    {last && <Button size="xs" tone="ghost" disabled={!picked.length} onClick={() => setForm(last)}>직전 입력값 불러오기</Button>}
                    {existing.length > 0 && <Button size="xs" tone="ghost" onClick={clearInfo}>기입 삭제</Button>}
                </div>
                {msg && <div className={msg.tone === 'danger' ? 'gi-error' : 'gi-muted'} style={msg.tone === 'ok' ? { color: '#4ade80' } : undefined}>{msg.text}</div>}
                <div className="gi-muted">저장하면 필지 위에 상호가 표시되고 업종 색으로 칠해집니다. 같은 필지를 다시 저장하면 수정됩니다.</div>
            </Section>

            <Section title={`기입 현황 ${filled.length}건`} right={<Button size="xs" onClick={exportCsv} disabled={!filled.length}>CSV 내보내기</Button>}>
                <div className="gi-grid-4">
                    <Stat label="기입 필지" value={filled.length} tone="ok" />
                    <Stat label="업체 수" value={companies.length} />
                    <Stat label="총 면적" value={fmt(filled.reduce((s, p) => s + (p.areaSqm || 0), 0) / 10000, 1)} unit="ha" />
                    <Stat label="시설 미등록" value={filled.filter((p) => !p.facilityId).length} />
                </div>
                <div className="gi-legend">{Object.entries(FACILITY_LABELS).map(([k, l]) => <span key={k}><i style={{ background: FACILITY_COLORS[k] }} />{l}</span>)}</div>
                <div className="gi-row">
                    <Input placeholder="상호 · 주소 · 대표자 · 연락처 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
                </div>
                <div className="gi-row">
                    <Button size="xs" disabled={!filled.length || busy} onClick={refreshBuildings}>건축물대장 정보 갱신 ({filled.length})</Button>
                    <Button size="xs" onClick={() => setMenu('parcel')}>CSV로 한꺼번에 입력 →</Button>
                    <span className="gi-muted">엑셀 명단이 있으면 주소·PNU로 자동 매칭됩니다</span>
                </div>
            </Section>

            <Table
                rows={rows.slice(0, 300)}
                activeKey={sel?.id}
                empty="아직 기입한 필지가 없습니다"
                onRowClick={(p) => { setSelected({ type: 'parcel', id: p.id }); if (p.lon != null) flyTo({ lon: p.lon, lat: p.lat, height: 260, pitch: -75 }); }}
                columns={[
                    { key: 'company', label: '상호 / 주소', render: (p) => <span><b>{p.company}</b>{p.ceo ? ` · ${p.ceo}` : ''}<br /><span className="gi-muted">{p.address}</span></span> },
                    { key: 'category', label: '업종', width: 70, render: (p) => (p.category ? <Badge color={FACILITY_COLORS[p.category] || '#94a3b8'} size="xs">{FACILITY_LABELS[p.category] || p.category}</Badge> : '-') },
                    { key: 'floors', label: '층·용도', width: 80, render: (p) => (p.floors ? <span>{p.floors}층<br /><span className="gi-muted">{p.usageName || '-'}</span></span> : '-') },
                    { key: 'areaSqm', label: '㎡', align: 'right', width: 60, render: (p) => fmt(p.areaSqm) },
                ]}
            />
        </>
    );
}

// 경위도 링의 대략 면적(㎡)
function approxArea(ring) {
    if (!ring || ring.length < 4) return 0;
    const lat0 = (ring[0][1] * Math.PI) / 180;
    const kx = 111320 * Math.cos(lat0);
    const ky = 110540;
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * kx * ring[i + 1][1] * ky - ring[i + 1][0] * kx * ring[i][1] * ky;
    return Math.abs(a) / 2;
}
