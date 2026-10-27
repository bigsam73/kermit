// 주소·필지: CSV 주소 목록 → 지오코딩 → 지적도식 필지 매핑 → 시설·입주기업 등록
import React, { useMemo, useRef, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Stat, Badge, Button, Input, Select, Table, Field, Toggle, KV, Bar, fmt } from '../components/ui';
import { readTextFile, parseCsv, guessColumns, SAMPLE_CSV, downloadText } from '../lib/csv';

const SOURCE_LABEL = { cadastral: '지적도 경계', osm: 'OSM 경계', approx: '근사 도형', none: '없음' };
const SOURCE_COLOR = { cadastral: '#38bdf8', osm: '#a78bfa', approx: '#fbbf24', none: '#6b7280' };
const ACC_LABEL = { parcel: '지번', road: '도로명', area: '동·리 수준(부정확)' };

const num = (v) => {
    const n = Number(String(v ?? '').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};
const inKorea = (lon, lat) => lon > 123.5 && lon < 132.5 && lat > 32.5 && lat < 39.5;

function boundsOf(parcels) {
    const pts = parcels.filter((p) => p.lon != null && p.lat != null);
    if (!pts.length) return null;
    const lons = pts.map((p) => p.lon);
    const lats = pts.map((p) => p.lat);
    return { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) };
}

export function flyToBounds(flyTo, b, { minHeight = 300 } = {}) {
    if (!b) return;
    const lon = (b.west + b.east) / 2;
    const lat = (b.south + b.north) / 2;
    const spanM = Math.max((b.east - b.west) * 111320 * Math.cos((lat * Math.PI) / 180), (b.north - b.south) * 110540, 60);
    flyTo({ lon, lat, height: Math.max(minHeight, spanM * 1.5), pitch: -60 });
}

export default function ParcelView() {
    const siteId = useIndustrialStore((s) => s.activeSiteId);
    const parcels = useIndustrialStore((s) => s.parcels);
    const parcelUi = useIndustrialStore((s) => s.parcelUi);
    const setParcelUi = useIndustrialStore((s) => s.setParcelUi);
    const selected = useIndustrialStore((s) => s.selected);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const setMenu = useIndustrialStore((s) => s.setMenu);

    const [file, setFile] = useState(null);
    const [csv, setCsv] = useState(null); // {headers, records}
    const [cols, setCols] = useState({});
    const [batchName, setBatchName] = useState('');
    const [progress, setProgress] = useState(null); // {done, total, ok, fail, phase}
    const [msg, setMsg] = useState(null);
    const [settings, setSettings] = useState(null);
    const [keyDraft, setKeyDraft] = useState({ vworldKey: '', kakaoKey: '', vworldDomain: '' });
    const [testAddr, setTestAddr] = useState('');
    const [testRes, setTestRes] = useState(null);
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState('all');
    const [edit, setEdit] = useState(null);
    const cancelRef = useRef(false);
    const busy = progress && progress.phase !== 'done';

    const loadSettings = async () => setSettings(await api.get('/api/geocode/settings'));
    React.useEffect(() => { loadSettings().catch(() => {}); }, []);

    const pickFile = async (f) => {
        setMsg(null);
        setFile(f);
        if (!f) { setCsv(null); return; }
        try {
            const text = await readTextFile(f);
            const parsed = parseCsv(text);
            if (!parsed.records.length) throw new Error('데이터 행이 없습니다');
            setCsv(parsed);
            setCols(guessColumns(parsed.headers));
            setBatchName(f.name.replace(/\.[^.]+$/, ''));
        } catch (err) {
            setCsv(null);
            setMsg({ tone: 'danger', text: `파일을 읽지 못했습니다: ${err.message}` });
        }
    };

    const hasCoords = Boolean(cols.lon && cols.lat);
    const colOptions = useMemo(() => [{ value: '', label: '(사용 안 함)' }, ...(csv?.headers || []).map((h) => ({ value: h, label: h }))], [csv]);

    const run = async () => {
        if (!csv || !siteId) return;
        if (!cols.address && !hasCoords) { setMsg({ tone: 'danger', text: '주소 열 또는 경도·위도 열을 선택하세요' }); return; }
        cancelRef.current = false;
        setMsg(null);
        const rows = csv.records;
        const out = new Array(rows.length).fill(null);
        const todo = [];
        rows.forEach((r, i) => {
            const lon = num(r[cols.lon]);
            const lat = num(r[cols.lat]);
            if (hasCoords && lon != null && lat != null && inKorea(lon, lat)) out[i] = { ok: true, lon, lat, geocoded: false };
            else if (cols.address && r[cols.address]) todo.push(i);
            else out[i] = { ok: false, error: '주소·좌표 없음' };
        });
        let done = 0;
        let fail = out.filter((o) => o && !o.ok).length;
        setProgress({ done: 0, total: todo.length, ok: 0, fail, phase: 'geocode' });
        const CH = 10;
        for (let k = 0; k < todo.length; k += CH) {
            if (cancelRef.current) break;
            const idxs = todo.slice(k, k + CH);
            try {
                const resp = await api.post('/api/geocode/batch', { rows: idxs.map((i) => ({ address: rows[i][cols.address] })) });
                resp.results.forEach((g, j) => { out[idxs[j]] = g; if (!g.ok) fail++; });
            } catch (err) {
                idxs.forEach((i) => { out[i] = { ok: false, error: err.message }; fail++; });
            }
            done += idxs.length;
            setProgress({ done, total: todo.length, ok: done, fail, phase: 'geocode' });
        }
        if (cancelRef.current) { setProgress(null); setMsg({ tone: 'warn', text: '중단했습니다 (저장하지 않음)' }); return; }
        setProgress({ done: todo.length, total: todo.length, ok: 0, fail, phase: 'save' });
        const payload = rows.map((r, i) => {
            const g = out[i] || { ok: false, error: '처리 안 됨' };
            return {
                address: r[cols.address] || '',
                name: r[cols.name] || '',
                company: r[cols.name] || null,
                lotNo: r[cols.lotNo] || null,
                category: r[cols.category] || null,
                areaSqm: num(r[cols.area]),
                lon: g.ok ? g.lon : null,
                lat: g.ok ? g.lat : null,
                polygon: g.polygon || null,
                polygonSource: g.polygonSource || null,
                geocoded: g.geocoded,
                provider: g.provider,
                accuracy: g.accuracy,
                matched: g.matched,
                pnu: g.pnu,
                error: g.ok ? null : g.error,
                attrs: r,
            };
        });
        const batchId = `pb-${Date.now().toString(36)}`;
        let okN = 0;
        let failN = 0;
        try {
            for (let k = 0; k < payload.length; k += 300) {
                const r = await api.post('/api/parcels/bulk', { siteId, batchId, batchName: batchName || file?.name, rows: payload.slice(k, k + 300) });
                okN += r.ok;
                failN += r.failed;
            }
            await refreshCollection('parcels');
            const addedIds = useIndustrialStore.getState().parcels.filter((p) => p.batchId === batchId && p.geometry).map((p) => p.id);
            let bld = 0;
            for (let k = 0; k < addedIds.length; k += 60) {
                setProgress({ done: k, total: addedIds.length, ok: bld, fail: failN, phase: 'enrich' });
                try { const e = await api.post('/api/parcels/enrich', { siteId, ids: addedIds.slice(k, k + 60) }); bld += e.withBuildings; } catch { /* 건축물 정보는 선택 사항 */ }
            }
            await refreshCollection('parcels');
            setProgress({ done: todo.length, total: todo.length, ok: okN, fail: failN, phase: 'done' });
            setMsg({ tone: failN ? 'warn' : 'ok', text: `필지 ${okN}건 매핑 완료${failN ? ` · 실패 ${failN}건 (아래 목록에서 주소 수정 후 재시도)` : ''}` });
            const added = useIndustrialStore.getState().parcels.filter((p) => p.batchId === batchId);
            flyToBounds(flyTo, boundsOf(added));
            setFile(null);
            setCsv(null);
        } catch (err) {
            setProgress(null);
            setMsg({ tone: 'danger', text: `저장 실패: ${err.message}` });
        }
    };

    const saveKeys = async () => {
        const patch = {};
        for (const [k, v] of Object.entries(keyDraft)) if (v.trim()) patch[k] = v.trim();
        setSettings(await api.put('/api/geocode/settings', patch));
        setKeyDraft({ vworldKey: '', kakaoKey: '', vworldDomain: '' });
    };
    const clearKey = async (k) => setSettings(await api.put('/api/geocode/settings', { [k]: '' }));
    const test = async () => {
        setTestRes({ loading: true });
        try { setTestRes(await api.get(`/api/geocode/test?address=${encodeURIComponent(testAddr)}`)); } catch (err) { setTestRes({ ok: false, error: err.message }); }
    };

    const rows = useMemo(() => parcels
        .filter((p) => filter === 'all' || (filter === 'failed' ? p.geocodeStatus === 'failed' : filter === 'approx' ? p.geometrySource === 'approx' : filter === 'area' ? p.accuracy === 'area' : filter === 'cadastral' ? p.geometrySource === 'cadastral' : true))
        .filter((p) => !q || `${p.address} ${p.name} ${p.company || ''} ${p.lotNo || ''}`.toLowerCase().includes(q.toLowerCase())), [parcels, q, filter]);
    const sel = selected?.type === 'parcel' ? parcels.find((p) => p.id === selected.id) : null;
    const batches = useMemo(() => {
        const m = new Map();
        parcels.forEach((p) => { const b = m.get(p.batchId) || { id: p.batchId, name: p.batchName || p.batchId, count: 0 }; b.count++; m.set(p.batchId, b); });
        return [...m.values()];
    }, [parcels]);
    const stat = (fn) => parcels.filter(fn).length;
    const registerable = parcels.filter((p) => p.geometry && !p.facilityId);

    const pick = (p) => {
        setSelected({ type: 'parcel', id: p.id });
        setEdit(null);
        if (p.lon != null) flyTo({ lon: p.lon, lat: p.lat, height: 260, pitch: -60 });
    };
    const saveEdit = async () => {
        const body = { name: edit.name, company: edit.company || null, lotNo: edit.lotNo || null, category: edit.category || null, areaSqm: num(edit.areaSqm) };
        await api.put(`/api/parcels/${edit.id}`, body);
        if (edit.address !== sel.address || edit.regeo) {
            const r = await api.post(`/api/parcels/${edit.id}/geocode`, { address: edit.address });
            if (!r.ok) setMsg({ tone: 'danger', text: `재지오코딩 실패: ${r.error}` });
        }
        if (edit.manualLon && edit.manualLat) await api.put(`/api/parcels/${edit.id}`, { lon: Number(edit.manualLon), lat: Number(edit.manualLat), relocate: true });
        setEdit(null);
        refreshCollection('parcels');
    };
    const toFacilities = async (ids) => {
        const r = await api.post('/api/parcels/to-facilities', { ids });
        await Promise.all([refreshCollection('parcels'), refreshCollection('facilities')]);
        setMsg({ tone: 'ok', text: `시설·입주기업 ${r.created}건 등록 (시설·입주기업 메뉴에서 속성 편집)` });
    };

    return (
        <>
            <Section title="① 주소 CSV 업로드" right={<Button size="xs" tone="ghost" onClick={() => downloadText('주소목록_샘플.csv', SAMPLE_CSV)}>샘플 CSV</Button>}>
                <div className="gi-muted">
                    열: 업체명 · 주소(지번/도로명) · 대지면적 등. 경도·위도 열이 있으면 지오코딩 없이 바로 찍습니다. 엑셀은 "CSV(쉼표로 분리)"로 저장하세요 (UTF-8·CP949 자동 인식).
                </div>
                <input type="file" accept=".csv,.txt,.tsv" className="gi-input" disabled={busy} onChange={(e) => pickFile(e.target.files?.[0] || null)} />
                {csv && (
                    <>
                        <div className="gi-muted">{csv.records.length.toLocaleString()}행 · {csv.headers.length}열 감지. 아래 열 지정을 확인하세요.</div>
                        <div className="gi-grid-2">
                            <Field label="주소 열 *"><Select value={cols.address || ''} onChange={(v) => setCols({ ...cols, address: v })} options={colOptions} /></Field>
                            <Field label="업체·시설명 열"><Select value={cols.name || ''} onChange={(v) => setCols({ ...cols, name: v })} options={colOptions} /></Field>
                            <Field label="필지번호 열"><Select value={cols.lotNo || ''} onChange={(v) => setCols({ ...cols, lotNo: v })} options={colOptions} /></Field>
                            <Field label="면적(㎡) 열" hint="없는 경계는 이 면적의 정사각형으로 근사"><Select value={cols.area || ''} onChange={(v) => setCols({ ...cols, area: v })} options={colOptions} /></Field>
                            <Field label="경도 열 (선택)"><Select value={cols.lon || ''} onChange={(v) => setCols({ ...cols, lon: v })} options={colOptions} /></Field>
                            <Field label="위도 열 (선택)"><Select value={cols.lat || ''} onChange={(v) => setCols({ ...cols, lat: v })} options={colOptions} /></Field>
                            <Field label="업종·유형 열" hint="factory / warehouse / office … 이면 시설 유형으로 사용"><Select value={cols.category || ''} onChange={(v) => setCols({ ...cols, category: v })} options={colOptions} /></Field>
                            <Field label="묶음 이름"><Input value={batchName} onChange={(e) => setBatchName(e.target.value)} /></Field>
                        </div>
                        <Table
                            rows={csv.records.slice(0, 4).map((r, i) => ({ ...r, id: i }))}
                            columns={csv.headers.slice(0, 5).map((h) => ({ key: h, label: h }))}
                        />
                        <div className="gi-row">
                            <Button tone="primary" size="md" disabled={busy || !siteId} onClick={run}>지오코딩 후 지도에 매핑</Button>
                            {busy && <Button size="md" tone="danger" onClick={() => { cancelRef.current = true; }}>중단</Button>}
                            {settings && !settings.vworld && !settings.kakao && !hasCoords && <span className="gi-muted">현재 OSM 무료 지오코더 · 약 {Math.ceil(csv.records.length * 1.2 / 60)}분 소요</span>}
                        </div>
                    </>
                )}
                {progress && (
                    <div>
                        <Bar value={progress.total ? progress.done : 1} max={progress.total || 1} label={progress.phase === 'enrich' ? `건축물대장 조회 ${progress.done}/${progress.total} (층수·용도 자동 채움)` : progress.phase === 'save' ? '저장 중…' : progress.phase === 'done' ? '완료' : `지오코딩 ${progress.done}/${progress.total} · 실패 ${progress.fail}`} />
                    </div>
                )}
                {msg && <div className={msg.tone === 'danger' ? 'gi-error' : 'gi-muted'} style={msg.tone === 'ok' ? { color: '#4ade80' } : msg.tone === 'warn' ? { color: '#fbbf24' } : undefined}>{msg.text}</div>}
            </Section>

            <Section title="지오코더 설정" right={settings && <div className="gi-row">{settings.providers.map((p) => <Badge key={p} color={p === 'nominatim' ? '#94a3b8' : '#22c55e'} size="xs">{p}</Badge>)}</div>}>
                <div className="gi-muted">
                    브이월드 키를 등록하면 <b>실제 연속지적도 필지 경계</b>까지 가져옵니다(권장, 무료 발급: vworld.kr). 키 없이도 OSM으로 좌표는 찍히지만 번지 단위 정확도가 낮고 필지 경계는 근사 도형이 됩니다.
                </div>
                {settings && (
                    <>
                        <div className="gi-grid-2">
                            <Field label={`브이월드 API 키 ${settings.vworld ? `(등록됨 ${settings.vworldKey})` : ''}`}><Input type="password" placeholder={settings.vworld ? '변경하려면 새 키 입력' : '키 입력'} value={keyDraft.vworldKey} onChange={(e) => setKeyDraft({ ...keyDraft, vworldKey: e.target.value })} /></Field>
                            <Field label="브이월드 도메인" hint="키 발급 시 등록한 서비스 URL 도메인"><Input placeholder={settings.vworldDomain} value={keyDraft.vworldDomain} onChange={(e) => setKeyDraft({ ...keyDraft, vworldDomain: e.target.value })} /></Field>
                            <Field label={`카카오 REST 키 ${settings.kakao ? `(등록됨 ${settings.kakaoKey})` : '(선택)'}`}><Input type="password" value={keyDraft.kakaoKey} onChange={(e) => setKeyDraft({ ...keyDraft, kakaoKey: e.target.value })} /></Field>
                        </div>
                        <div className="gi-row">
                            <Button size="xs" tone="primary" onClick={saveKeys}>키 저장</Button>
                            {settings.vworld && <Button size="xs" tone="ghost" onClick={() => clearKey('vworldKey')}>브이월드 키 삭제</Button>}
                            {settings.kakao && <Button size="xs" tone="ghost" onClick={() => clearKey('kakaoKey')}>카카오 키 삭제</Button>}
                        </div>
                    </>
                )}
                <div className="gi-row">
                    <Input placeholder="주소 한 건 테스트" value={testAddr} onChange={(e) => setTestAddr(e.target.value)} style={{ flex: 1 }} />
                    <Button size="xs" disabled={!testAddr || testRes?.loading} onClick={test}>테스트</Button>
                </div>
                {testRes && !testRes.loading && (testRes.ok
                    ? <div className="gi-muted">✔ {testRes.provider} · {ACC_LABEL[testRes.accuracy] || testRes.accuracy} · {testRes.lon.toFixed(6)}, {testRes.lat.toFixed(6)} · 경계 {SOURCE_LABEL[testRes.polygonSource] || '근사'}<br />{testRes.matched}</div>
                    : <div className="gi-error">{testRes.error}</div>)}
            </Section>

            <Section title="연속지적도 (브이월드)" right={<Toggle checked={Boolean(parcelUi.cadastral)} onChange={(v) => { try { localStorage.setItem('gi:cadastral', v ? '1' : '0'); } catch { /* ignore */ } setParcelUi({ cadastral: v }); }} label="지도에 표시" />}>
                <div className="gi-muted">전국 지적 경계와 지번(본번·부번)을 지도 위에 겹쳐 봅니다. 지도를 약 1.5 km 이하로 확대하면 노란 경계선과 지번이 3D 타일 위에 겹쳐 보입니다. 브이월드 키가 필요합니다{settings && !settings.vworld ? ' — 아래 지오코더 설정에서 등록하세요.' : '.'}</div>
            </Section>

            <Section title={`필지 ${parcels.length.toLocaleString()}건`} right={<Toggle checked={parcelUi.visible} onChange={(v) => setParcelUi({ visible: v })} label="지도 표시" />}>
                <div className="gi-grid-4">
                    <Stat label="매핑" value={stat((p) => p.geocodeStatus !== 'failed')} tone="ok" />
                    <Stat label="실패" value={stat((p) => p.geocodeStatus === 'failed')} tone={stat((p) => p.geocodeStatus === 'failed') ? 'warn' : 'default'} />
                    <Stat label="지적도 경계" value={stat((p) => p.geometrySource === 'cadastral')} />
                    <Stat label="근사 도형" value={stat((p) => p.geometrySource === 'approx')} />
                </div>
                <Toggle checked={parcelUi.labels} onChange={(v) => setParcelUi({ labels: v })} label="필지 라벨" />
                <div className="gi-legend">
                    {['cadastral', 'osm', 'approx'].map((k) => <span key={k}><i style={{ background: SOURCE_COLOR[k] }} />{SOURCE_LABEL[k]}</span>)}
                </div>
                <div className="gi-row">
                    <Input placeholder="주소 · 업체 · 필지 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
                    <Select value={filter} onChange={setFilter} style={{ width: 120 }} options={[{ value: 'all', label: '전체' }, { value: 'failed', label: '실패만' }, { value: 'area', label: '정확도 낮음' }, { value: 'approx', label: '근사 도형' }, { value: 'cadastral', label: '지적도 경계' }]} />
                </div>
                <div className="gi-row">
                    <Button size="xs" tone="primary" disabled={!registerable.length} onClick={() => window.confirm(`경계가 있는 필지 ${registerable.length}건을 시설·입주기업으로 등록할까요?`) && toFacilities(registerable.map((p) => p.id))}>시설·입주기업으로 일괄 등록 ({registerable.length})</Button>
                    <Button size="xs" onClick={() => flyToBounds(flyTo, boundsOf(parcels))} disabled={!parcels.length}>전체 보기</Button>
                    <Button size="xs" disabled={!registerable.length && !parcels.some((p) => p.geometry)} onClick={async () => { const ids = parcels.filter((p) => p.geometry).map((p) => p.id); setMsg({ tone: 'warn', text: '건축물대장 조회 중…' }); let ok = 0; let wb = 0; for (let k = 0; k < ids.length; k += 60) { try { const e = await api.post('/api/parcels/enrich', { siteId, ids: ids.slice(k, k + 60) }); ok += e.ok; wb += e.withBuildings; } catch (err) { setMsg({ tone: 'danger', text: err.message }); return; } } await refreshCollection('parcels'); setMsg({ tone: 'ok', text: `건축물 정보 ${wb}건 채움 (조회 ${ok}건)` }); }}>건축물 정보 자동 채움</Button>
                </div>
                {batches.length > 0 && (
                    <div className="gi-muted">
                        묶음: {batches.map((b) => (
                            <span key={b.id} style={{ marginRight: 10 }}>
                                {b.name} ({b.count}) <a href="#" onClick={async (e) => { e.preventDefault(); if (window.confirm(`'${b.name}' 묶음 ${b.count}건을 삭제할까요?`)) { await api.del(`/api/parcels?siteId=${encodeURIComponent(siteId)}&batchId=${encodeURIComponent(b.id)}`); refreshCollection('parcels'); } }}>삭제</a>
                            </span>
                        ))}
                    </div>
                )}
            </Section>

            {sel && !edit && (
                <Section title={sel.name || sel.address} right={<Button size="xs" tone="ghost" onClick={() => setSelected(null)}>닫기</Button>}>
                    <div className="gi-row">
                        <Badge color={SOURCE_COLOR[sel.geometrySource]} size="xs">{SOURCE_LABEL[sel.geometrySource]}</Badge>
                        {sel.accuracy && <Badge color={sel.accuracy === 'area' ? '#f59e0b' : '#22c55e'} size="xs">{ACC_LABEL[sel.accuracy] || sel.accuracy}</Badge>}
                        {sel.geocodeStatus === 'failed' && <Badge color="#ef4444" size="xs">지오코딩 실패</Badge>}
                        {sel.facilityId && <Badge color="#22c55e" size="xs">시설 등록됨</Badge>}
                    </div>
                    <KV items={[['주소', sel.address], ['매칭 결과', sel.matched], ['업체', sel.company], ['대표자', sel.ceo], ['업종', sel.industry], ['연락처', sel.phone], ['비고', sel.memo], ['층수', sel.floors ? `지상 ${sel.floors}층${sel.basementFloors ? ` / 지하 ${sel.basementFloors}층` : ''}` : null], ['건축물 용도', sel.usageName ? `${sel.usageName}${sel.usageList?.length > 1 ? ` 외 ${sel.usageList.length - 1}종` : ''}` : null], ['건물 수', sel.bldCount != null ? `${sel.bldCount}동` : null], ['건축면적', sel.bldArchAreaSqm ? `${Number(sel.bldArchAreaSqm).toLocaleString('ko-KR')} ㎡` : null], ['연면적', sel.bldTotalAreaSqm ? `${Number(sel.bldTotalAreaSqm).toLocaleString('ko-KR')} ㎡` : null], ['구조', sel.structure], ['사용승인', sel.approvedFirst ? `${String(sel.approvedFirst).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}${sel.approvedLast && sel.approvedLast !== sel.approvedFirst ? ' ~ ' + String(sel.approvedLast).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : ''}` : null], ['건폐율/용적률', sel.bcRat ? `${sel.bcRat}% / ${sel.vlRat}%` : null], ['필지번호', sel.lotNo], ['PNU', sel.pnu], ['면적', sel.areaSqm ? `${fmt(sel.areaSqm)} ㎡` : null], ['좌표', sel.lon != null ? `${sel.lon.toFixed(6)}, ${sel.lat.toFixed(6)}` : null], ['지오코더', sel.provider], ['오류', sel.error], ...Object.entries(sel.attrs || {}).slice(0, 10)]} />
                    <div className="gi-row">
                        <Button size="xs" onClick={() => setEdit({ ...sel, manualLon: '', manualLat: '' })}>편집·재지오코딩</Button>
                        {!sel.facilityId && sel.geometry && <Button size="xs" tone="primary" onClick={() => toFacilities([sel.id])}>시설로 등록</Button>}
                        {sel.facilityId && <Button size="xs" onClick={() => { setSelected({ type: 'facility', id: sel.facilityId }); setMenu('facility'); }}>시설 메뉴</Button>}
                        <Button size="xs" tone="ghost" onClick={async () => { if (window.confirm('이 필지를 삭제할까요?')) { await api.del(`/api/parcels/${sel.id}`); setSelected(null); refreshCollection('parcels'); } }}>삭제</Button>
                    </div>
                </Section>
            )}
            {edit && (
                <Section title="필지 편집" right={<Button size="xs" tone="ghost" onClick={() => setEdit(null)}>취소</Button>}>
                    <Field label="주소" hint="바꾸면 저장 시 다시 지오코딩합니다"><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
                    <div className="gi-grid-2">
                        <Field label="업체·시설명"><Input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value, company: e.target.value })} /></Field>
                        <Field label="필지번호"><Input value={edit.lotNo || ''} onChange={(e) => setEdit({ ...edit, lotNo: e.target.value })} /></Field>
                        <Field label="면적(㎡)"><Input type="number" value={edit.areaSqm || ''} onChange={(e) => setEdit({ ...edit, areaSqm: e.target.value })} /></Field>
                        <Field label="업종·유형"><Input value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
                        <Field label="경도 직접 입력"><Input placeholder="예: 127.8022" value={edit.manualLon} onChange={(e) => setEdit({ ...edit, manualLon: e.target.value })} /></Field>
                        <Field label="위도 직접 입력"><Input placeholder="예: 37.2961" value={edit.manualLat} onChange={(e) => setEdit({ ...edit, manualLat: e.target.value })} /></Field>
                    </div>
                    <Button tone="primary" onClick={saveEdit}>저장</Button>
                </Section>
            )}

            <Table
                rows={rows.slice(0, 400)}
                activeKey={sel?.id}
                onRowClick={pick}
                empty="CSV를 업로드하면 이곳에 필지가 표시됩니다"
                columns={[
                    { key: 'name', label: '업체 / 주소', render: (p) => <span title={p.address}>{p.company || p.name || p.address}<br /><span className="gi-muted">{p.address}</span></span> },
                    { key: 'geometrySource', label: '경계', width: 70, render: (p) => <Badge color={SOURCE_COLOR[p.geometrySource]} size="xs">{SOURCE_LABEL[p.geometrySource]}</Badge> },
                    { key: 'geocodeStatus', label: '상태', width: 60, render: (p) => (p.geocodeStatus === 'failed' ? <span style={{ color: '#f87171' }}>실패</span> : p.accuracy === 'area' ? <span style={{ color: '#fbbf24' }}>낮음</span> : 'OK') },
                ]}
            />
            {rows.length > 400 && <div className="gi-muted">상위 400건만 표시 ({rows.length.toLocaleString()}건 중). 검색으로 좁혀 보세요.</div>}
        </>
    );
}
