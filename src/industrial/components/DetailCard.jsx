// 지구본에서 선택한 객체(시설/PV/핫스팟/센서/도크/사진) 상세 카드
import React from 'react';
import useStore from '../../store/useStore';
import useIndustrialStore from '../store';
import { Badge, Button, KV, fmt, fmtTime } from './ui';
import { FACILITY_COLORS, FACILITY_LABELS, HEALTH_COLORS, HEALTH_LABELS, SEVERITY_COLORS, SEVERITY_LABELS, DOCK_STATE_LABELS } from '../constants';
import { api } from '../api';

export default function DetailCard() {
    const inspector = useStore((s) => s.inspector);
    const clearInspector = useStore((s) => s.clearInspector);
    const selected = useIndustrialStore((s) => s.selected);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const facilities = useIndustrialStore((s) => s.facilities);
    const parcels = useIndustrialStore((s) => s.parcels);
    const panelArrays = useIndustrialStore((s) => s.panelArrays);
    const hotspots = useIndustrialStore((s) => s.hotspots);
    const sensors = useIndustrialStore((s) => s.sensors);
    const docks = useIndustrialStore((s) => s.docks);
    const photos = useIndustrialStore((s) => s.photos);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    const flyTo = useIndustrialStore((s) => s.flyTo);

    const sel = selected || (inspector?._industrialType ? { type: inspector._industrialType, id: inspector._industrialId } : null);
    if (!sel) return null;

    const close = () => {
        setSelected(null);
        clearInspector();
    };

    let title = '';
    let badge = null;
    let items = [];
    let actions = [];
    let media = null;

    if (sel.type === 'facility') {
        const f = facilities.find((x) => x.id === sel.id);
        if (!f) return null;
        const pv = panelArrays.filter((a) => a.facilityId === f.id);
        title = f.name;
        badge = <Badge color={FACILITY_COLORS[f.type]}>{FACILITY_LABELS[f.type] || f.typeLabel}</Badge>;
        items = [
            ['입주기업', f.company || '-'], ['필지번호', f.lotNo], ['상태', f.status === 'operating' ? '가동 중' : f.status === 'maintenance' ? '정비 중' : '공실'],
            ['층수/높이', `${f.floors}층 · ${fmt(f.heightM, 1)} m`], ['지붕', `${f.roofType || '-'} · ${fmt(f.roofAreaSqm)} ㎡`], ['필지 면적', `${fmt(f.lotAreaSqm)} ㎡`],
            ['상시 인원', `${fmt(f.employees)}명`], ['월 전력사용', `${fmt(f.energyKwhMonth)} kWh`], ['유해요인', f.hazard], ['위험도', `${f.riskScore}/100`],
            ['최근 점검', f.lastInspection], ['태양광', pv.length ? `${pv.length}개 어레이 · ${fmt(pv.reduce((s, a) => s + a.capacityKwp, 0))} kWp` : '미설치'],
        ];
        actions = [
            <Button key="fac" onClick={() => setMenu('facility')}>시설 메뉴</Button>,
            pv.length ? <Button key="pv" onClick={() => { setSelected({ type: 'panelArray', id: pv[0].id }); setMenu('solar'); }}>PV 보기</Button> : null,
        ];
    } else if (sel.type === 'parcel') {
        const pc = parcels.find((x) => x.id === sel.id);
        if (!pc) return null;
        title = pc.company || pc.name || pc.address;
        badge = <Badge color={pc.geometrySource === 'cadastral' ? '#38bdf8' : '#fbbf24'}>{pc.geometrySource === 'cadastral' ? '지적도 경계' : pc.geometrySource === 'osm' ? 'OSM 경계' : '근사 도형'}</Badge>;
        items = [['주소', pc.address], ['대표자', pc.ceo], ['업종', pc.industry], ['연락처', pc.phone], ['비고', pc.memo], ['층수', pc.floors ? `지상 ${pc.floors}층${pc.basementFloors ? ` / 지하 ${pc.basementFloors}층` : ''}` : null], ['건축물 용도', pc.usageName ? `${pc.usageName}${pc.usageList?.length > 1 ? ` 외 ${pc.usageList.length - 1}종` : ''}` : null], ['건물 수', pc.bldCount != null ? `${pc.bldCount}동` : null], ['건축면적', pc.bldArchAreaSqm ? `${Number(pc.bldArchAreaSqm).toLocaleString('ko-KR')} ㎡` : null], ['연면적', pc.bldTotalAreaSqm ? `${Number(pc.bldTotalAreaSqm).toLocaleString('ko-KR')} ㎡` : null], ['구조', pc.structure], ['사용승인', pc.approvedFirst ? `${String(pc.approvedFirst).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}${pc.approvedLast && pc.approvedLast !== pc.approvedFirst ? ' ~ ' + String(pc.approvedLast).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : ''}` : null], ['건폐율/용적률', pc.bcRat ? `${pc.bcRat}% / ${pc.vlRat}%` : null], ['필지번호', pc.lotNo], ['PNU', pc.pnu], ['면적', pc.areaSqm ? `${fmt(pc.areaSqm)} ㎡` : null], ['정확도', pc.accuracy === 'area' ? '동·리 수준(부정확)' : pc.accuracy], ['지오코더', pc.provider], ['시설 등록', pc.facilityId ? '등록됨' : '미등록'], ...Object.entries(pc.attrs || {}).slice(0, 8)];
        actions = [<Button key="pc" onClick={() => setMenu('parcel')}>주소·필지 메뉴</Button>];
    } else if (sel.type === 'panelArray') {
        const a = panelArrays.find((x) => x.id === sel.id);
        if (!a) return null;
        const live = telemetry?.pv?.inverters?.find((i) => i.arrayId === a.id);
        const hs = hotspots.filter((h) => h.arrayId === a.id);
        title = a.name;
        badge = <Badge color={HEALTH_COLORS[a.health?.status || 'normal']} dot>{HEALTH_LABELS[a.health?.status || 'normal']}</Badge>;
        items = [
            ['설비용량', `${fmt(a.capacityKwp, 1)} kWp`], ['모듈', `${fmt(a.moduleCount)}매 × ${a.moduleWp} W`], ['면적', `${fmt(a.areaSqm)} ㎡`], ['경사/방위', `${a.tiltDeg}° / ${a.azimuthDeg}°`],
            ['인버터', `${a.inverterCount}대`], ['설치일', a.installedAt], ['최근 세척', a.lastCleaning], ['최근 열화상', a.lastThermalInspection || '없음'],
            ['현재 출력', live ? `${fmt(live.powerKw, 1)} kW (${live.efficiency}%)` : '-'], ['모듈 온도', live ? `${live.moduleTempC} °C` : '-'],
            ['핫스팟', hs.length ? `${hs.length}건 (심각 ${hs.filter((h) => h.severity === 'critical').length})` : '없음'], ['건전성 계수', a.health?.healthFactor ?? 1],
        ];
        actions = [
            <Button key="solar" onClick={() => setMenu('solar')}>태양광 메뉴</Button>,
            hs.length ? <Button key="th" onClick={() => setMenu('thermal')}>핫스팟 보기</Button> : null,
        ];
    } else if (sel.type === 'hotspot') {
        const h = hotspots.find((x) => x.id === sel.id);
        if (!h) return null;
        title = `핫스팟 #${h.index}`;
        badge = <Badge color={SEVERITY_COLORS[h.severity]} dot>{SEVERITY_LABELS[h.severity]}</Badge>;
        items = [
            ['최고 온도', `${h.maxT} °C`], ['평균 온도', `${h.meanT} °C`], ['기준 대비', `+${h.deltaT} °C (기준 ${h.baselineT ?? '-'} °C)`], ['면적', `${h.areaSqm} ㎡ (${h.pixels} px)`],
            ['분류', h.arrayId ? `PV · ${h.arrayName}` : 'PV 외 고온원'], ['위치', `${h.lat.toFixed(6)}, ${h.lon.toFixed(6)}`], ['탐지 시각', fmtTime(h.detectedAt)], ['처리 상태', h.status === 'resolved' ? '조치 완료' : h.status === 'confirmed' ? '현장 확인' : '미확인'],
        ];
        actions = [
            <Button key="c" onClick={async () => { await api.put(`/api/hotspots/${h.id}`, { status: 'confirmed' }); useIndustrialStore.getState().refreshCollection('hotspots'); }}>현장 확인</Button>,
            <Button key="r" tone="success" onClick={async () => { await api.put(`/api/hotspots/${h.id}`, { status: 'resolved' }); useIndustrialStore.getState().refreshCollection('hotspots'); }}>조치 완료</Button>,
        ];
    } else if (sel.type === 'sensor') {
        const s = sensors.find((x) => x.id === sel.id);
        if (!s) return null;
        const live = telemetry?.sensors?.find((x) => x.sensorId === s.id);
        title = s.name;
        badge = <Badge color={live?.status === 'warning' ? '#f59e0b' : '#22c55e'} dot>{live?.status === 'warning' ? '주의' : '정상'}</Badge>;
        const r = live?.reading || {};
        items = [['유형', s.type], ['PM10', `${r.pm10 ?? '-'} ㎍/㎥`], ['PM2.5', `${r.pm25 ?? '-'} ㎍/㎥`], ['NO₂', `${r.no2 ?? '-'} ppb`], ['VOC', `${r.voc ?? '-'} ppm`], ['소음', `${r.noiseDb ?? '-'} dB`], ['온도/습도', `${r.tempC ?? '-'} °C / ${r.humidity ?? '-'} %`], ['설치일', s.installedAt]];
        actions = [<Button key="env" onClick={() => setMenu('env')}>환경 메뉴</Button>];
    } else if (sel.type === 'dock') {
        const d = docks.find((x) => x.id === sel.id);
        if (!d) return null;
        const live = telemetry?.docks?.find((x) => x.dockId === d.id);
        title = d.name;
        badge = <Badge color={live?.state === 'IN_MISSION' ? '#38bdf8' : '#22c55e'} dot>{DOCK_STATE_LABELS[live?.state] || '대기'}</Badge>;
        items = [['기종', d.model], ['배터리', live ? `${live.battery}%` : '-'], ['풍속', live ? `${live.windMs} m/s` : '-'], ['내부 온도', live ? `${live.internalTempC} °C` : '-'], ['설치일', d.installedAt]];
        actions = [<Button key="dr" onClick={() => setMenu('drone')}>드론 운용</Button>];
    } else if (sel.type === 'photo') {
        const p = photos.find((x) => x.id === sel.id);
        if (!p) return null;
        title = p.name;
        badge = <Badge color={p.kind === 'thermal' ? '#f97316' : '#38bdf8'}>{p.kind === 'thermal' ? '열화상' : p.kind === 'wide' ? '광각' : p.kind === 'visible' ? '가시광' : '사진'}</Badge>;
        items = [['촬영 시각', fmtTime(p.takenAt)], ['기체/카메라', p.camera || '-'], ['고도', p.relativeAltitude != null ? `${p.relativeAltitude} m (상대)` : p.altitude != null ? `${fmt(p.altitude, 1)} m` : '-'], ['방위', p.heading != null ? `${p.heading}°` : '-'], ['해상도', p.width ? `${p.width}×${p.height}` : '-'], ['위치', p.lat != null ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}` : '-']];
        media = p.thumbUrl ? <a href={api.url(`/api/photos/${p.id}/file`)} target="_blank" rel="noreferrer"><img src={api.url(p.thumbUrl)} alt={p.name} className="gi-detail-media" /></a> : null;
    } else {
        return null;
    }

    const target = (() => {
        if (sel.type === 'facility') { const f = facilities.find((x) => x.id === sel.id); return f && { lon: f.lon, lat: f.lat }; }
        if (sel.type === 'parcel') { const pc = parcels.find((x) => x.id === sel.id); return pc?.lon != null && { lon: pc.lon, lat: pc.lat, height: 260 }; }
        if (sel.type === 'panelArray') {
            const a = panelArrays.find((x) => x.id === sel.id);
            const f = a && facilities.find((x) => x.id === a.facilityId);
            if (f) return { lon: f.lon, lat: f.lat };
            const ring = a?.geometry?.coordinates?.[0];
            if (!ring?.length) return null;
            const n = ring.length - 1;
            return { lon: ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n, lat: ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n, height: 260 };
        }
        if (sel.type === 'hotspot') { const h = hotspots.find((x) => x.id === sel.id); return h && { lon: h.lon, lat: h.lat, height: 160 }; }
        if (sel.type === 'sensor') { const s = sensors.find((x) => x.id === sel.id); return s && { lon: s.lon, lat: s.lat }; }
        if (sel.type === 'dock') { const d = docks.find((x) => x.id === sel.id); return d && { lon: d.lon, lat: d.lat }; }
        if (sel.type === 'photo') { const p = photos.find((x) => x.id === sel.id); return p?.lat != null && { lon: p.lon, lat: p.lat, height: 220 }; }
        return null;
    })();

    return (
        <div className="gi-detail glass-panel pointer-events-auto animate-slide-right">
            <header className="gi-detail-head">
                <div className="min-w-0">
                    <div className="gi-detail-title" title={title}>{title}</div>
                    <div className="mt-1">{badge}</div>
                </div>
                <button className="gi-panel-close" onClick={close}>✕</button>
            </header>
            {media}
            <KV items={items} />
            <div className="gi-detail-actions">
                {target && <Button onClick={() => flyTo({ lon: target.lon, lat: target.lat, height: target.height || 420, pitch: -55 })}>위치로 이동</Button>}
                {actions}
            </div>
        </div>
    );
}
