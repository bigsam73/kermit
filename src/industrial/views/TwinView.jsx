// 3D 디지털트윈: 실측 3D Tiles · 건물 돌출 · 조명/시간 · 뷰 프리셋
import React from 'react';
import * as Cesium from 'cesium';
import useIndustrialStore from '../store';
import useStore from '../../store/useStore';
import { Section, Badge, Button, Toggle, Field, Input, fmt } from '../components/ui';

export default function TwinView() {
    const datasets = useIndustrialStore((s) => s.datasets);
    const overlayState = useIndustrialStore((s) => s.overlayState);
    const setOverlay = useIndustrialStore((s) => s.setOverlay);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const site = useIndustrialStore((s) => s.sites.find((x) => x.id === s.activeSiteId));
    const facilities = useIndustrialStore((s) => s.facilities);
    const twin = useIndustrialStore((s) => s.twin);
    const viewer = useStore((s) => s.viewerRef);
    const layers = useStore((s) => s.layers);
    const toggleLayer = useStore((s) => s.toggleLayer);
    const tilesets = datasets.filter((d) => d.type === '3dtiles' || d.type === 'pointcloud');

    const setTwin = (patch) => useIndustrialStore.setState((s) => ({ twin: { ...(s.twin || {}), ...patch } }));

    const applyTime = (hour) => {
        if (!viewer || viewer.isDestroyed()) return;
        const d = new Date();
        d.setHours(hour, 0, 0, 0);
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
        viewer.scene.globe.enableLighting = true;
        viewer.scene.requestRender();
        setTwin({ hour });
    };

    const preset = (kind) => {
        if (!site) return;
        const base = { lon: site.lon, lat: site.lat };
        if (kind === 'top') flyTo({ ...base, height: site.cameraHeight || 2000, pitch: -89, heading: 0 });
        if (kind === 'oblique') flyTo({ ...base, height: 900, pitch: -35, heading: 35 });
        if (kind === 'street') flyTo({ ...base, height: 60, pitch: -12, heading: 120 });
        if (kind === 'north') flyTo({ ...base, height: 1200, pitch: -45, heading: 0 });
    };

    return (
        <>
            <Section title="실측 3D Tiles" right={<span>{tilesets.length}개</span>}>
                {tilesets.map((ds) => {
                    const st = overlayState[ds.id] || { visible: false };
                    return (
                        <div key={ds.id} className="gi-list-item" style={{ flexDirection: 'column' }}>
                            <div className="gi-between" style={{ width: '100%' }}>
                                <div className="min-w-0">
                                    <div className="gi-list-title">{ds.name}</div>
                                    <div className="gi-list-sub">{ds.platform} · {ds.capturedAt} {ds.center?.radius ? `· 반경 ${fmt(ds.center.radius)} m` : ''}</div>
                                </div>
                                <span className={`toggle-switch ${st.visible ? 'active' : ''}`} onClick={() => setOverlay(ds.id, { visible: !st.visible })} />
                            </div>
                            <div className="gi-row" style={{ width: '100%' }}>
                                {ds.center && <Button size="xs" onClick={() => flyTo({ lon: ds.center.lon, lat: ds.center.lat, height: Math.max(600, (ds.center.radius || 800) * 1.4), pitch: -40, heading: 20 })}>모델로 이동</Button>}
                                <Badge color={ds.type === 'pointcloud' ? '#fbbf24' : '#34d399'}>{ds.type === 'pointcloud' ? '포인트클라우드' : 'b3dm 메시'}</Badge>
                                <Badge color="#94a3b8">{ds.tilesetUrl ? '서빙 중' : '경로 미설정'}</Badge>
                            </div>
                        </div>
                    );
                })}
                {!tilesets.length && (
                    <div className="gi-empty">
                        이 단지에 등록된 3D Tiles가 없습니다.<br />
                        RealityScan / DJI Terra / iTwin Capture로 만든 Cesium 3D Tiles(tileset.json) 경로를 영상자료 메뉴에서 '3D Tiles' 유형으로 등록하세요.
                    </div>
                )}
            </Section>

            <Section title="건물 모델 (속성 기반 돌출)">
                <Toggle label="시설 건물 3D 돌출" checked={Boolean(layers.facilities?.enabled)} onChange={() => toggleLayer('facilities')} />
                <Toggle label="PV 어레이 표시" checked={Boolean(layers.solarPanels?.enabled)} onChange={() => toggleLayer('solarPanels')} />
                <Field label={`높이 배율 ×${twin.heightScale || 1}`}>
                    <input type="range" min="0.5" max="3" step="0.1" className="gi-input" value={twin.heightScale || 1} onChange={(e) => setTwin({ heightScale: Number(e.target.value) })} />
                </Field>
                <div className="gi-muted">시설 {facilities.length}동 · 층수·지붕 유형 속성으로 생성한 블록 모델. 실측 3D Tiles가 있는 영역에서는 돌출을 끄면 실제 외형을 볼 수 있습니다.</div>
            </Section>

            <Section title="조명 · 시간대">
                <div className="gi-row">
                    {[6, 9, 12, 15, 18, 21].map((h) => <Button key={h} size="xs" tone={twin.hour === h ? 'primary' : 'default'} onClick={() => applyTime(h)}>{h}시</Button>)}
                    <Button size="xs" tone="ghost" onClick={() => { if (viewer) { viewer.clock.currentTime = Cesium.JulianDate.now(); viewer.scene.requestRender(); } setTwin({ hour: null }); }}>현재</Button>
                </div>
                <div className="gi-muted">태양 고도에 따른 그림자·음영 확인 (PV 음영 분석 참고용).</div>
            </Section>

            <Section title="뷰 프리셋">
                <div className="gi-grid-4">
                    <Button onClick={() => preset('top')}>수직</Button>
                    <Button onClick={() => preset('oblique')}>경사</Button>
                    <Button onClick={() => preset('street')}>지상</Button>
                    <Button onClick={() => preset('north')}>북향</Button>
                </div>
                <Field label={`3D Tiles 상세도 · SSE ${twin.tilesLod ?? 2}`} hint="작을수록 멀리서도 고해상도 (16 = Cesium 기본). 기본 2 · 실측 소형 타일셋(Terra b3dm)은 자동으로 1/4 적용">
                    <input type="range" min="1" max="16" step="1" className="gi-input" value={twin.tilesLod ?? 2} onChange={(e) => { const v = Number(e.target.value); setTwin({ tilesLod: v }); try { localStorage.setItem('gi:tilesLod', String(v)); } catch { /* ignore */ } }} />
                </Field>
                <Field label={`3D Tiles 높이 보정 (m) · 자동 ${twin.tilesAutoOffset ?? '-'}`} hint="타원체 지형 위에 실측 모델이 떠 보이거나 묻히면 조정">
                    <input type="range" min="-250" max="250" step="1" className="gi-input" value={twin.tilesHeightOffset ?? twin.tilesAutoOffset ?? 0} onChange={(e) => setTwin({ tilesHeightOffset: Number(e.target.value) })} />
                </Field>
                <Field label="지형 과장 (Cesium)">
                    <Input type="number" step="0.5" min="1" max="5" value={twin.terrainExaggeration || 1} onChange={(e) => { const v = Number(e.target.value) || 1; setTwin({ terrainExaggeration: v }); if (viewer) { viewer.scene.verticalExaggeration = v; viewer.scene.requestRender(); } }} />
                </Field>
            </Section>

            <Section title="데이터 파이프라인">
                <div className="gi-muted" style={{ lineHeight: 1.6 }}>
                    드론 촬영 → RealityScan/DJI Terra 포토그래메트리 → Cesium 3D Tiles 내보내기 → 영상자료 메뉴 등록.
                    LiDAR 포인트클라우드(LAS)는 py3dtiles/Cesium ion으로 3D Tiles 변환 후 동일하게 등록합니다. 분기별 재촬영으로 시설 변경·증축을 비교할 수 있습니다.
                </div>
            </Section>
        </>
    );
}
