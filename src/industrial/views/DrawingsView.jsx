// 도면 중첩: SHP / DXF / GeoJSON / KML 업로드 → WGS84 변환 → 지도에 중첩 표시
import React, { useEffect, useRef, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Badge, Button, Input, Select, Field, Toggle, KV, fmt } from '../components/ui';
import { flyToBounds } from './ParcelView';

const KIND_LABEL = { shp: 'SHP', dxf: 'DXF', geojson: 'GeoJSON', kml: 'KML', gpkg: 'GPKG' };
const ENCODINGS = [{ value: 'auto', label: '자동 (SHP는 .cpg 없으면 CP949)' }, { value: 'CP949', label: 'CP949 (한글 윈도우)' }, { value: 'UTF-8', label: 'UTF-8' }];

export default function DrawingsView() {
    const siteId = useIndustrialStore((s) => s.activeSiteId);
    const drawings = useIndustrialStore((s) => s.drawings);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const flyTo = useIndustrialStore((s) => s.flyTo);

    const [files, setFiles] = useState([]);
    const [name, setName] = useState('');
    const [srcEpsg, setSrcEpsg] = useState('auto');
    const [encoding, setEncoding] = useState('auto');
    const [crsList, setCrsList] = useState([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [open, setOpen] = useState(null);
    const [recon, setRecon] = useState({ srcEpsg: 'auto', encoding: 'auto' });
    const timers = useRef({});

    useEffect(() => { api.get('/api/drawings/crs').then(setCrsList).catch(() => {}); }, []);
    const crsOptions = [{ value: 'auto', label: '자동 판별 (.prj 또는 좌표 범위)' }, { value: '4326', label: 'EPSG:4326 WGS84 경위도' }, ...crsList.map((c) => ({ value: String(c.epsg), label: `EPSG:${c.epsg} ${c.label}` }))];

    const upload = async () => {
        if (!files.length || !siteId) return;
        setBusy(true);
        setMsg(null);
        try {
            const fd = new FormData();
            fd.append('siteId', siteId);
            fd.append('srcEpsg', srcEpsg);
            fd.append('encoding', encoding);
            if (name.trim()) fd.append('name', name.trim());
            files.forEach((f) => fd.append('files', f));
            const d = await api.upload('/api/drawings/upload', fd);
            await refreshCollection('drawings');
            setMsg({ tone: 'ok', text: `${d.name}: ${fmt(d.featureCount)}개 도형 · ${d.crs?.label || ''}` });
            setFiles([]);
            setName('');
            setOpen(d.id);
            flyToBounds(flyTo, d.bounds, { minHeight: 400 });
        } catch (err) {
            setMsg({ tone: 'danger', text: err.message });
        } finally {
            setBusy(false);
        }
    };

    // 즉시 화면 반영 + 서버 저장(디바운스)
    const patch = (d, p) => {
        useIndustrialStore.setState((s) => ({ drawings: s.drawings.map((x) => (x.id === d.id ? { ...x, ...p } : x)) }));
        clearTimeout(timers.current[d.id]);
        timers.current[d.id] = setTimeout(() => api.put(`/api/drawings/${d.id}`, p).catch(() => {}), 350);
    };
    const reconvert = async (d) => {
        setBusy(true);
        setMsg(null);
        try {
            await api.post(`/api/drawings/${d.id}/reconvert`, recon);
            await refreshCollection('drawings');
            setMsg({ tone: 'ok', text: `${d.name}: 다시 변환했습니다` });
        } catch (err) {
            setMsg({ tone: 'danger', text: err.message });
        } finally {
            setBusy(false);
        }
    };
    const remove = async (d) => {
        if (!window.confirm(`'${d.name}' 도면을 삭제할까요? (업로드 원본 포함)`)) return;
        await api.del(`/api/drawings/${d.id}`);
        refreshCollection('drawings');
    };

    return (
        <>
            <Section title="도면 업로드">
                <div className="gi-muted">
                    <b>SHP</b>: .shp .dbf .shx (.prj .cpg 권장)를 함께 선택하거나 .zip 하나로 · <b>DXF</b> · GeoJSON · KML · GPKG. 좌표계는 .prj 가 있으면 자동, 없으면 국내 좌표계(중부·서부·동부원점, UTM-K 등)를 단지 위치 기준으로 자동 판별합니다.
                </div>
                <input type="file" multiple accept=".shp,.shx,.dbf,.prj,.cpg,.zip,.dxf,.geojson,.json,.kml,.gpkg" className="gi-input" disabled={busy} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
                {files.length > 0 && <div className="gi-muted">{files.length}개 선택: {files.map((f) => f.name).join(', ')}</div>}
                <div className="gi-grid-2">
                    <Field label="도면 이름"><Input placeholder="비우면 파일명" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                    <Field label="인코딩(문자)"><Select value={encoding} onChange={setEncoding} options={ENCODINGS} /></Field>
                </div>
                <Field label="좌표계"><Select value={srcEpsg} onChange={setSrcEpsg} options={crsOptions} /></Field>
                <Button tone="primary" size="md" disabled={busy || !files.length || !siteId} onClick={upload}>{busy ? '변환 중…' : '업로드 후 지도에 중첩'}</Button>
                {msg && <div className={msg.tone === 'danger' ? 'gi-error' : 'gi-muted'} style={msg.tone === 'ok' ? { color: '#4ade80' } : undefined}>{msg.text}</div>}
            </Section>

            {!drawings.length && <div className="gi-empty">이 단지에 중첩한 도면이 없습니다.<br />위에서 SHP 또는 DXF를 올려 보세요.</div>}

            {drawings.map((d) => {
                const isOpen = open === d.id;
                const layerNames = Object.keys(d.layers || {});
                const hasPoly = Object.keys(d.geomTypes || {}).some((k) => /Polygon/.test(k));
                const hidden = new Set(d.hiddenLayers || []);
                return (
                    <Section
                        key={d.id}
                        title={<span><i style={{ display: 'inline-block', width: 10, height: 10, background: d.color, marginRight: 6, borderRadius: 2 }} />{d.name}</span>}
                        right={<Toggle checked={d.visible} onChange={(v) => patch(d, { visible: v })} label="표시" />}
                    >
                        <div className="gi-row">
                            <Badge color="#38bdf8" size="xs">{KIND_LABEL[d.kind] || d.kind}</Badge>
                            <Badge color="#94a3b8" size="xs">{fmt(d.featureCount)}개 도형</Badge>
                            <Badge color="#94a3b8" size="xs">{(d.sizeBytes / 1048576).toFixed(1)} MB</Badge>
                            <span className="gi-muted">{d.crs?.label}</span>
                        </div>
                        <div className="gi-row">
                            <Button size="xs" onClick={() => flyToBounds(flyTo, d.bounds, { minHeight: 400 })}>도면 위치로 이동</Button>
                            <Button size="xs" tone="ghost" onClick={() => { setOpen(isOpen ? null : d.id); setRecon({ srcEpsg: d.srcEpsg || 'auto', encoding: d.encoding || 'auto' }); }}>{isOpen ? '설정 접기' : '스타일·설정'}</Button>
                            <Button size="xs" tone="ghost" onClick={() => remove(d)}>삭제</Button>
                        </div>
                        {isOpen && (
                            <>
                                <div className="gi-grid-2">
                                    <Field label="색상"><input type="color" className="gi-input" value={d.color} onChange={(e) => patch(d, { color: e.target.value })} /></Field>
                                    <Field label={`선 굵기 ${d.lineWidth}`}><input type="range" min="1" max="6" step="0.5" className="gi-input" value={d.lineWidth} onChange={(e) => patch(d, { lineWidth: Number(e.target.value) })} /></Field>
                                </div>
                                <Field label={`투명도 ${Math.round(d.opacity * 100)}%`}><input type="range" min="0.1" max="1" step="0.05" className="gi-input" value={d.opacity} onChange={(e) => patch(d, { opacity: Number(e.target.value) })} /></Field>
                                <Toggle checked={d.clamp} onChange={(v) => patch(d, { clamp: v })} label="지면·건물에 밀착(클램프)" />
                                {hasPoly && <Toggle checked={d.fill !== false} onChange={(v) => patch(d, { fill: v })} label="면 채우기" />}
                                {d.kind === 'dxf' && <Toggle checked={d.useSourceColors !== false} onChange={(v) => patch(d, { useSourceColors: v })} label="DXF 원본 색상 사용" />}
                                <Toggle checked={d.showLabels} onChange={(v) => patch(d, { showLabels: v })} label="라벨(문자·속성) 표시" />
                                {d.showLabels && (d.fields || []).length > 0 && (
                                    <Field label="라벨 속성"><Select value={d.labelField || ''} onChange={(v) => patch(d, { labelField: v })} options={[{ value: '', label: '자동 (문자/지번/명칭)' }, ...d.fields.map((f) => ({ value: f, label: f }))]} /></Field>
                                )}
                                {layerNames.length > 1 && (
                                    <Field label={`도면 레이어 (${layerNames.length})`}>
                                        <div style={{ maxHeight: 160, overflowY: 'auto', display: 'grid', gap: 2 }}>
                                            {layerNames.map((l) => (
                                                <label key={l} className="gi-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                    <input type="checkbox" checked={!hidden.has(l)} onChange={(e) => patch(d, { hiddenLayers: e.target.checked ? [...hidden].filter((x) => x !== l) : [...hidden, l] })} />
                                                    {l} <span style={{ opacity: 0.6 }}>({d.layers[l]})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </Field>
                                )}
                                <div className="gi-muted" style={{ marginTop: 6 }}>위치가 어긋나거나 글자가 깨지면 좌표계·인코딩을 바꿔 다시 변환하세요.</div>
                                <div className="gi-grid-2">
                                    <Field label="좌표계"><Select value={recon.srcEpsg} onChange={(v) => setRecon({ ...recon, srcEpsg: v })} options={crsOptions} /></Field>
                                    <Field label="인코딩"><Select value={recon.encoding} onChange={(v) => setRecon({ ...recon, encoding: v })} options={ENCODINGS} /></Field>
                                </div>
                                <Button size="xs" disabled={busy} onClick={() => reconvert(d)}>이 설정으로 다시 변환</Button>
                                <KV items={[['파일', (d.files || []).join(', ')], ['도형 종류', Object.entries(d.geomTypes || {}).map(([k, v]) => `${k} ${v}`).join(' · ')], ['속성 필드', (d.fields || []).slice(0, 12).join(', ')]]} />
                            </>
                        )}
                    </Section>
                );
            })}
        </>
    );
}
