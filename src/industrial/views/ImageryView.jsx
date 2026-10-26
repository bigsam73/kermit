// 영상자료: 위성 · 드론 정사영상 · 3D · 사진 데이터셋 관리
import React, { useState } from 'react';
import useIndustrialStore from '../store';
import useStore from '../../store/useStore';
import { api } from '../api';
import { Section, Badge, Button, Toggle, Field, Input, Select, Bar, fmt, fmtDate, Spinner } from '../components/ui';
import { DATASET_TYPE_LABELS } from '../constants';

const TYPE_COLORS = { orthophoto: '#38bdf8', thermal: '#f97316', satellite: '#a78bfa', '3dtiles': '#34d399', pointcloud: '#fbbf24', dsm: '#94a3b8', ndvi: '#84cc16', photos: '#f472b6' };

export default function ImageryView() {
    const datasets = useIndustrialStore((s) => s.datasets);
    const overlayState = useIndustrialStore((s) => s.overlayState);
    const setOverlay = useIndustrialStore((s) => s.setOverlay);
    const jobs = useIndustrialStore((s) => s.jobs);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    const systemStatus = useIndustrialStore((s) => s.systemStatus);
    const imageryEnabled = useStore((s) => s.layers.imagery?.enabled);
    const toggleLayer = useStore((s) => s.toggleLayer);
    const [tab, setTab] = useState('list');
    const [form, setForm] = useState({ name: '', type: 'orthophoto', sourcePath: '', capturedAt: '', platform: '' });
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const register = async () => {
        setBusy(true);
        setMsg('');
        try {
            await api.post('/api/datasets/register', { ...form, siteId: activeSiteId });
            setMsg('등록 완료. 미리보기/타일 생성이 백그라운드에서 진행됩니다.');
            setForm({ name: '', type: 'orthophoto', sourcePath: '', capturedAt: '', platform: '' });
            refreshCollection('datasets');
            setTab('list');
        } catch (err) {
            setMsg(`실패: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };
    const upload = async () => {
        if (!file) return;
        setBusy(true);
        setMsg('');
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('siteId', activeSiteId);
            fd.append('name', form.name || file.name);
            fd.append('type', form.type);
            if (form.capturedAt) fd.append('capturedAt', form.capturedAt);
            if (form.platform) fd.append('platform', form.platform);
            await api.upload('/api/datasets/upload', fd);
            setMsg('업로드 완료. 처리 작업이 시작되었습니다.');
            setFile(null);
            refreshCollection('datasets');
            setTab('list');
        } catch (err) {
            setMsg(`실패: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };
    const remove = async (ds) => {
        if (!window.confirm(`'${ds.name}' 데이터셋을 삭제할까요? (원본 로컬 파일은 유지)`)) return;
        await api.del(`/api/datasets/${ds.id}`);
        refreshCollection('datasets');
    };

    const jobFor = (id) => jobs.find((j) => j.datasetId === id && (j.status === 'running' || j.status === 'queued'));

    return (
        <>
            <div className="gi-row gi-between">
                <div className="gi-row">
                    <Button tone={tab === 'list' ? 'primary' : 'ghost'} onClick={() => setTab('list')}>데이터셋 {datasets.length}</Button>
                    <Button tone={tab === 'add' ? 'primary' : 'ghost'} onClick={() => setTab('add')}>+ 등록/업로드</Button>
                    <Button tone={tab === 'sat' ? 'primary' : 'ghost'} onClick={() => setTab('sat')}>위성</Button>
                </div>
                <Toggle checked={Boolean(imageryEnabled)} onChange={() => toggleLayer('imagery')} label="오버레이" />
            </div>

            {tab === 'list' && (
                <div className="gi-list">
                    {datasets.map((ds) => {
                        const st = overlayState[ds.id] || { visible: false, opacity: 1 };
                        const job = jobFor(ds.id);
                        const canOverlay = ['orthophoto', 'thermal', 'satellite', 'ndvi', 'dsm', '3dtiles', 'pointcloud', 'photos'].includes(ds.type);
                        return (
                            <div key={ds.id} className="gi-list-item" style={{ flexDirection: 'column', gap: 6 }}>
                                <div className="gi-between" style={{ width: '100%' }}>
                                    <div className="min-w-0">
                                        <div className="gi-list-title" title={ds.name}>{ds.name}</div>
                                        <div className="gi-row" style={{ marginTop: 3 }}>
                                            <Badge color={TYPE_COLORS[ds.type] || '#94a3b8'}>{DATASET_TYPE_LABELS[ds.type] || ds.type}</Badge>
                                            <Badge color="#94a3b8">{ds.source === 'satellite' ? '위성' : '드론'}</Badge>
                                            {ds.capturedAt && <span className="gi-muted">{fmtDate(ds.capturedAt)}</span>}
                                            {ds.isSynthetic && <Badge color="#f472b6">합성 데모</Badge>}
                                        </div>
                                    </div>
                                    {canOverlay && <span className={`toggle-switch ${st.visible ? 'active' : ''}`} onClick={() => setOverlay(ds.id, { visible: !st.visible })} />}
                                </div>
                                <div className="gi-list-sub" style={{ width: '100%' }}>
                                    {ds.platform && <span>{ds.platform} · </span>}
                                    {ds.width && <span>{fmt(ds.width)}×{fmt(ds.height)} px · </span>}
                                    {ds.gsd && <span>GSD {ds.gsd < 1 ? `${(ds.gsd * 100).toFixed(1)} cm` : `${ds.gsd.toFixed(1)} m`} · </span>}
                                    {ds.epsg && <span>EPSG:{ds.epsg} · </span>}
                                    {ds.photoCount != null && <span>사진 {fmt(ds.photoCount)}장 (GPS {fmt(ds.photoWithGps)}) · </span>}
                                    {ds.hotspotCount != null && <span>핫스팟 {ds.hotspotCount}건 · </span>}
                                    <span>
                                        {ds.type === '3dtiles' || ds.type === 'pointcloud' ? '3D Tiles 서빙 중' : ds.type === 'photos' ? (ds.photoCount ? '인덱싱 완료' : '인덱싱 필요') : ds.tilesStatus === 'ready' ? `타일 z${ds.minZoom || 12}-${ds.maxZoom}${ds.tilesSource === 'external' ? ' (Terra)' : ''}` : ds.tilesStatus === 'running' ? '타일 생성 중' : ds.tilesStatus === 'error' ? '타일 오류' : ds.previewUrl ? '미리보기 오버레이' : ds.status === 'processing' ? '처리 중' : '처리 대기'}
                                    </span>
                                </div>
                                {job && (
                                    <div style={{ width: '100%' }}>
                                        <div className="gi-between gi-muted"><span><Spinner label={job.type === 'photo-index' ? '사진 인덱싱' : '처리'} /> {job.lastLog}</span><span>{job.progress}%</span></div>
                                        <Bar value={job.progress} color="#38bdf8" height={4} />
                                    </div>
                                )}
                                {st.visible && canOverlay && ds.type !== '3dtiles' && ds.type !== 'pointcloud' && ds.type !== 'photos' && (
                                    <div className="gi-row" style={{ width: '100%' }}>
                                        <span className="gi-muted">투명도</span>
                                        <input type="range" min="0.1" max="1" step="0.05" value={st.opacity} className="gi-input" style={{ flex: 1 }} onChange={(e) => setOverlay(ds.id, { opacity: Number(e.target.value) })} />
                                    </div>
                                )}
                                <div className="gi-row" style={{ width: '100%' }}>
                                    {(ds.bounds || ds.center) && <Button size="xs" onClick={() => flyTo(ds.center ? { lon: ds.center.lon, lat: ds.center.lat, height: (ds.center.radius || 1200) * 1.6, pitch: -45 } : { lon: (ds.bounds.west + ds.bounds.east) / 2, lat: (ds.bounds.south + ds.bounds.north) / 2, height: Math.max(400, (ds.bounds.east - ds.bounds.west) * 111320 * 1.3), pitch: -70 })}>이동</Button>}
                                    {ds.type === 'thermal' && <Button size="xs" onClick={() => setMenu('thermal')}>열화상 분석</Button>}
                                    {ds.type === 'photos' && <Button size="xs" onClick={async () => { await api.post(`/api/datasets/${ds.id}/index-photos`, { limit: 1500 }); refreshCollection('photos'); refreshCollection('datasets'); }}>사진 인덱싱</Button>}
                                    {['orthophoto', 'thermal', 'satellite', 'ndvi', 'dsm'].includes(ds.type) && !job && <Button size="xs" onClick={async () => { await api.post(`/api/datasets/${ds.id}/process`, { tiles: ds.type !== 'thermal' }); refreshCollection('datasets'); }}>{ds.tilesStatus === 'ready' ? '재처리' : '타일 생성'}</Button>}
                                    {ds.previewUrl && <a className="gi-btn gi-btn--xs" href={api.url(ds.previewUrl)} target="_blank" rel="noreferrer">미리보기</a>}
                                    <Button size="xs" tone="ghost" onClick={() => remove(ds)}>삭제</Button>
                                </div>
                            </div>
                        );
                    })}
                    {!datasets.length && <div className="gi-empty">등록된 데이터셋이 없습니다. "+ 등록/업로드"로 정사영상·열화상·3D Tiles를 추가하세요.</div>}
                </div>
            )}

            {tab === 'add' && (
                <>
                    <Section title="서버 로컬 경로 등록" right={<span>대용량 권장</span>}>
                        <Field label="이름"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 북평산단 열화상 정사영상 2026-10" /></Field>
                        <div className="gi-grid-2">
                            <Field label="유형"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={Object.entries(DATASET_TYPE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                            <Field label="촬영일"><Input type="date" value={form.capturedAt} onChange={(e) => setForm({ ...form, capturedAt: e.target.value })} /></Field>
                        </div>
                        <Field label="경로 (GeoTIFF / tileset.json / 사진 폴더)" hint="서버 PC 기준 절대경로. 예: D:\drone\2026-10\thermal_ortho.tif"><Input value={form.sourcePath} onChange={(e) => setForm({ ...form, sourcePath: e.target.value })} placeholder="D:\..." /></Field>
                        <Field label="플랫폼/장비"><Input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} placeholder="DJI M4T + DJI Terra / Sentinel-2 / Pix4D" /></Field>
                        <Button tone="primary" size="md" disabled={busy || !form.sourcePath} onClick={register}>{busy ? '처리 중…' : '등록'}</Button>
                    </Section>
                    <Section title="파일 업로드 (브라우저)">
                        <Input type="file" accept=".tif,.tiff,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        <Button tone="primary" size="md" disabled={busy || !file} onClick={upload}>{busy ? '업로드 중…' : '업로드 후 처리'}</Button>
                        <div className="gi-muted">GDAL: {systemStatus?.gdal?.available ? `사용 가능 (${systemStatus.gdal.dir})` : '미설치 — 타일 생성 불가, 미리보기만'}</div>
                    </Section>
                    {msg && <div className="gi-muted">{msg}</div>}
                </>
            )}

            {tab === 'sat' && (
                <>
                    <Section title="위성영상 소스">
                        <div className="gi-list">
                            <div className="gi-list-item"><div><div className="gi-list-title">Esri World Imagery (기본 배경)</div><div className="gi-list-sub">항상 표시되는 전지구 고해상 위성 모자이크. 별도 설정 불필요.</div></div></div>
                            <div className="gi-list-item"><div><div className="gi-list-title">Sentinel-2 L2A (10 m, 5일 주기)</div><div className="gi-list-sub">Copernicus Browser에서 단지 영역 GeoTIFF를 받아 "등록/업로드"로 추가하면 타일로 변환됩니다. 식생·열섬·확장공사 변화 탐지용.</div></div></div>
                            <div className="gi-list-item"><div><div className="gi-list-title">Landsat 8/9 열적외 (100 m)</div><div className="gi-list-sub">지표면 온도(LST) 밴드로 단지 열섬 추세 분석. USGS EarthExplorer 다운로드 후 '열화상 정사영상' 유형으로 등록.</div></div></div>
                            <div className="gi-list-item"><div><div className="gi-list-title">국토위성 CAS500 / 아리랑 3A</div><div className="gi-list-sub">국토지리정보원 국토위성센터 / KARI 공급 영상 등록 가능 (GeoTIFF, EPSG 5186/5179 지원).</div></div></div>
                        </div>
                    </Section>
                    <Section title="광역 위성·환경 피드 (godseye 레이어)">
                        <div className="gi-muted">우측 상단 "피드" 버튼으로 위성 궤도, 산불 열점(NASA FIRMS), 기상특보, 대기질 등 광역 레이어를 켤 수 있습니다.</div>
                        <div className="gi-row">
                            {['satellites', 'fireHotspots', 'weather', 'airQuality', 'seismic'].map((k) => (
                                <Button key={k} size="xs" onClick={() => toggleLayer(k)}>{{ satellites: '위성 궤도', fireHotspots: '산불 열점', weather: '기상', airQuality: '대기질', seismic: '지진' }[k]}</Button>
                            ))}
                        </div>
                    </Section>
                </>
            )}
        </>
    );
}
