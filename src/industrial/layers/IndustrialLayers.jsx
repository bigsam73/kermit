// 산업단지 Cesium 레이어: 단지 경계 · 시설 건물 · PV 어레이 · 핫스팟 · 센서 · 드론 · 영상 오버레이 · 3D Tiles · 카메라
import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import useStore from '../../store/useStore';
import useIndustrialStore from '../store';
import { api } from '../api';
import { ParcelsLayer, DrawingsLayer, CadastralLayer, LotPicker } from './GeoLayers';
import { FACILITY_COLORS, FACILITY_LABELS, HEALTH_COLORS, HEALTH_LABELS, SEVERITY_COLORS, SEVERITY_LABELS, THERMAL_PALETTES, DOCK_STATE_LABELS } from '../constants';

const css = (hex, alpha = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
const FAR = Number.POSITIVE_INFINITY;

function useEntityCollection(viewer, name) {
    const ref = useRef(null);
    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return undefined;
        const ds = new Cesium.CustomDataSource(name);
        viewer.dataSources.add(ds);
        ref.current = ds;
        return () => {
            if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
            ref.current = null;
        };
    }, [viewer, name]);
    return ref;
}

// ── 단지 경계 ───────────────────────────────────────────
export function SitesLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.sites?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const sites = useIndustrialStore((s) => s.sites);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const dsRef = useEntityCollection(viewer, 'gi-sites');
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        if (!enabled) { update('sites', []); return; }
        sites.forEach((site) => {
            if (!site.boundary) return;
            const active = site.id === activeSiteId;
            const color = active ? '#38bdf8' : '#94a3b8';
            ds.entities.add({
                id: `gi-site-${site.id}`,
                name: site.name,
                polyline: { positions: Cesium.Cartesian3.fromDegreesArray(site.boundary.flat()), width: active ? 3 : 1.5, material: new Cesium.PolylineDashMaterialProperty({ color: css(color, 0.9), dashLength: 12 }), clampToGround: true },
                properties: { _layerType: 'sites', _industrialType: 'site', _industrialId: site.id, 지역: site.region, 면적: `${site.areaHa} ha`, 입주기업: `${site.companies}개사` },
            });
            ds.entities.add({
                id: `gi-site-label-${site.id}`,
                position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 10),
                label: { text: site.name, font: '600 13px "Noto Sans KR", sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), scaleByDistance: new Cesium.NearFarScalar(2000, 1, 400000, 0.5), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500000), disableDepthTestDistance: FAR },
                properties: { _layerType: 'sites', _industrialType: 'site', _industrialId: site.id },
            });
        });
        update('sites', sites, { sourceName: '산업단지 DB' });
    }, [enabled, sites, activeSiteId, dsRef, update]);
    return null;
}

// ── 시설 건물 (돌출) ─────────────────────────────────────
export function FacilitiesLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.facilities?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const facilities = useIndustrialStore((s) => s.facilities);
    const selected = useIndustrialStore((s) => s.selected);
    const heightScale = useIndustrialStore((s) => s.twin?.heightScale || 1);
    const dsRef = useEntityCollection(viewer, 'gi-facilities');
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        if (!enabled) { update('facilities', []); return; }
        facilities.forEach((f) => {
            const ring = f.geometry?.coordinates?.[0];
            if (!ring) return;
            const base = FACILITY_COLORS[f.type] || '#94a3b8';
            const isSel = selected?.type === 'facility' && selected.id === f.id;
            const h = (f.type === 'vacant' ? 0.5 : f.heightM || 8) * heightScale;
            ds.entities.add({
                id: `gi-fac-${f.id}`,
                name: f.name,
                polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()), height: 0, extrudedHeight: h, material: css(base, isSel ? 0.75 : f.type === 'vacant' ? 0.18 : 0.42), outline: true, outlineColor: css(isSel ? '#ffffff' : base, 0.9), outlineWidth: 1 },
                properties: { _layerType: 'facilities', _industrialType: 'facility', _industrialId: f.id, 입주기업: f.company || '-', 유형: FACILITY_LABELS[f.type], 필지: f.lotNo, 상태: f.status === 'operating' ? '가동' : f.status === 'maintenance' ? '정비' : '공실', 지붕면적: `${Math.round(f.roofAreaSqm)} ㎡`, 태양광: f.pvInstalled ? '설치' : '미설치', 위험도: f.riskScore },
            });
            if (f.lotGeometry?.coordinates?.[0]) {
                ds.entities.add({ id: `gi-lot-${f.id}`, polyline: { positions: Cesium.Cartesian3.fromDegreesArray(f.lotGeometry.coordinates[0].flat()), width: 1, material: css('#ffffff', 0.18), clampToGround: true }, properties: { _layerType: 'facilities', _industrialType: 'facility', _industrialId: f.id } });
            }
            ds.entities.add({
                id: `gi-fac-label-${f.id}`,
                position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h + 2),
                label: { text: (f.company || f.name).replace('(주)', ''), font: '11px "Noto Sans KR", sans-serif', fillColor: Cesium.Color.WHITE.withAlpha(0.95), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2600), disableDepthTestDistance: FAR, scaleByDistance: new Cesium.NearFarScalar(300, 1, 2600, 0.6) },
                properties: { _layerType: 'facilities', _industrialType: 'facility', _industrialId: f.id },
            });
        });
        update('facilities', facilities, { sourceName: '시설 DB' });
    }, [enabled, facilities, selected, heightScale, dsRef, update]);
    return null;
}

// ── PV 어레이 ───────────────────────────────────────────
export function SolarPanelsLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.solarPanels?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const arrays = useIndustrialStore((s) => s.panelArrays);
    const facilities = useIndustrialStore((s) => s.facilities);
    const facilitiesEnabled = useStore((s) => s.layers.facilities?.enabled);
    const selected = useIndustrialStore((s) => s.selected);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const heightScale = useIndustrialStore((s) => s.twin?.heightScale || 1);
    const dsRef = useEntityCollection(viewer, 'gi-pv');
    const liveRef = useRef({});
    liveRef.current = Object.fromEntries((telemetry?.pv?.inverters || []).map((i) => [i.arrayId, i]));
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        if (!enabled) { update('solarPanels', []); return; }
        arrays.forEach((a) => {
            const ring = a.geometry?.coordinates?.[0];
            if (!ring) return;
            const fac = facilities.find((f) => f.id === a.facilityId);
            const roof = facilitiesEnabled ? (fac?.heightM || 8) * heightScale : 0;
            const status = a.health?.status || 'normal';
            const color = HEALTH_COLORS[status];
            const isSel = selected?.type === 'panelArray' && selected.id === a.id;
            ds.entities.add({
                id: `gi-pv-${a.id}`,
                name: a.name,
                polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()), height: roof + 0.3, extrudedHeight: roof + 0.9, material: new Cesium.StripeMaterialProperty({ evenColor: css('#0f172a', 0.9), oddColor: css(color, isSel ? 0.95 : 0.7), repeat: 16, orientation: Cesium.StripeOrientation.HORIZONTAL }), outline: true, outlineColor: css(isSel ? '#ffffff' : color, 1), outlineWidth: isSel ? 2 : 1 },
                properties: { _layerType: 'solarPanels', _industrialType: 'panelArray', _industrialId: a.id, 용량: `${a.capacityKwp} kWp`, 모듈: `${a.moduleCount}매`, 건전성: HEALTH_LABELS[status], 핫스팟: `${a.health?.hotspotCount || 0}건`, 출력: new Cesium.CallbackProperty(() => `${liveRef.current[a.id]?.powerKw ?? '-'} kW`, false), 모듈온도: new Cesium.CallbackProperty(() => `${liveRef.current[a.id]?.moduleTempC ?? '-'} °C`, false), 최근세척: a.lastCleaning },
            });
            const c = ring.slice(0, 4).reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0]);
            ds.entities.add({
                id: `gi-pv-label-${a.id}`,
                position: Cesium.Cartesian3.fromDegrees(c[0], c[1], roof + 4),
                label: { text: new Cesium.CallbackProperty(() => `☀ ${liveRef.current[a.id]?.powerKw ?? '-'} kW`, false), font: '600 11px "JetBrains Mono", monospace', fillColor: css(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800), disableDepthTestDistance: FAR, pixelOffset: new Cesium.Cartesian2(0, 14) },
                properties: { _layerType: 'solarPanels', _industrialType: 'panelArray', _industrialId: a.id },
            });
        });
        update('solarPanels', arrays, { sourceName: 'PV 자산 DB' });
    }, [enabled, arrays, facilities, facilitiesEnabled, selected, heightScale, dsRef, update]);
    return null;
}

// ── 열 핫스팟 ───────────────────────────────────────────
export function HotspotsLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.thermalHotspots?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const hotspots = useIndustrialStore((s) => s.hotspots);
    const highlight = useIndustrialStore((s) => s.highlightHotspotId);
    const facilities = useIndustrialStore((s) => s.facilities);
    const arrays = useIndustrialStore((s) => s.panelArrays);
    const facilitiesEnabled = useStore((s) => s.layers.facilities?.enabled);
    const heightScale = useIndustrialStore((s) => s.twin?.heightScale || 1);
    const dsRef = useEntityCollection(viewer, 'gi-hotspots');
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        if (!enabled) { update('thermalHotspots', []); return; }
        // 과밀 방지: 최고온도 순 상위 200건 + 강조 항목만 표시
        const MAX_SHOWN = 200;
        const active = hotspots.filter((h) => h.status !== 'resolved').sort((a, b) => b.maxT - a.maxT);
        const visible = active.length > MAX_SHOWN ? active.filter((h, i) => i < MAX_SHOWN || h.id === highlight) : active;
        visible.forEach((h) => {
            const color = SEVERITY_COLORS[h.severity] || '#f97316';
            const arr = h.arrayId ? arrays.find((a) => a.id === h.arrayId) : null;
            const fac = arr ? facilities.find((f) => f.id === arr.facilityId) : null;
            const roof = facilitiesEnabled && fac ? (fac.heightM || 8) * heightScale : 0;
            const isHi = highlight === h.id;
            const size = h.severity === 'critical' ? 14 : h.severity === 'high' ? 11 : 8;
            ds.entities.add({
                id: `gi-hs-${h.id}`,
                name: `핫스팟 #${h.index}`,
                position: Cesium.Cartesian3.fromDegrees(h.lon, h.lat, roof + 1.5),
                point: { pixelSize: isHi ? size + 8 : size, color: css(color, 0.95), outlineColor: Cesium.Color.WHITE.withAlpha(isHi ? 1 : 0.7), outlineWidth: isHi ? 3 : 1.5, disableDepthTestDistance: FAR, scaleByDistance: new Cesium.NearFarScalar(200, 1.3, 3000, 0.7) },
                label: { text: `${h.maxT}°`, font: '600 10px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1200), disableDepthTestDistance: FAR },
                properties: { _layerType: 'thermalHotspots', _industrialType: 'hotspot', _industrialId: h.id, 등급: SEVERITY_LABELS[h.severity], 최고온도: `${h.maxT} °C`, 기준대비: `+${h.deltaT} °C`, 면적: `${h.areaSqm} ㎡`, 위치: h.arrayName || 'PV 외 고온원', 상태: h.status === 'confirmed' ? '현장 확인' : '미확인' },
            });
            if (h.polygon) {
                ds.entities.add({ id: `gi-hs-poly-${h.id}`, polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(h.polygon.flat()), height: roof + 1.0, material: css(color, isHi ? 0.5 : 0.25), outline: true, outlineColor: css(color, 0.9) }, properties: { _layerType: 'thermalHotspots', _industrialType: 'hotspot', _industrialId: h.id } });
            }
        });
        update('thermalHotspots', visible, { sourceName: '열화상 분석' });
    }, [enabled, hotspots, highlight, facilities, arrays, facilitiesEnabled, heightScale, dsRef, update]);
    return null;
}

// ── 센서 ────────────────────────────────────────────────
export function SensorsLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.sensors?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const sensors = useIndustrialStore((s) => s.sensors);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const dsRef = useEntityCollection(viewer, 'gi-sensors');
    const liveRef = useRef({});
    liveRef.current = Object.fromEntries((telemetry?.sensors || []).map((x) => [x.sensorId, x]));
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        if (!enabled) { update('sensors', []); return; }
        const icon = { air: '◉', noise: '♪', voc: '✺', weather: '☂' };
        sensors.forEach((s) => {
            const text = () => {
                const r = liveRef.current[s.id]?.reading;
                if (!r) return `${icon[s.type] || '●'} ${s.name}`;
                if (s.type === 'air') return `◉ PM10 ${r.pm10} · PM2.5 ${r.pm25}`;
                if (s.type === 'noise') return `♪ ${r.noiseDb} dB`;
                if (s.type === 'voc') return `✺ VOC ${r.voc} ppm`;
                return `☂ ${r.tempC}°C · ${r.humidity}%`;
            };
            ds.entities.add({
                id: `gi-sensor-${s.id}`,
                name: s.name,
                position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 4),
                point: { pixelSize: 9, color: new Cesium.CallbackProperty(() => css(liveRef.current[s.id]?.status === 'warning' ? '#f59e0b' : '#22c55e'), false), outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: FAR },
                label: { text: new Cesium.CallbackProperty(text, false), font: '10.5px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(12, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500), disableDepthTestDistance: FAR },
                properties: { _layerType: 'sensors', _industrialType: 'sensor', _industrialId: s.id, 유형: s.type, 설치일: s.installedAt },
            });
        });
        update('sensors', sensors, { sourceName: '단지 센서망' });
    }, [enabled, sensors, dsRef, update]);
    return null;
}

// ── 드론: 스테이션 · 임무 중 기체 · 사진 ──────────────────
export function DroneLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.droneOps?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const docks = useIndustrialStore((s) => s.docks);
    const photos = useIndustrialStore((s) => s.photos);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const site = useIndustrialStore((s) => s.sites.find((x) => x.id === s.activeSiteId));
    const dsRef = useEntityCollection(viewer, 'gi-drone');
    const liveRef = useRef({});
    liveRef.current = Object.fromEntries((telemetry?.docks || []).map((d) => [d.dockId, d]));
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        if (!enabled) { update('droneOps', []); return; }
        docks.forEach((d) => {
            ds.entities.add({
                id: `gi-dock-${d.id}`,
                name: d.name,
                position: Cesium.Cartesian3.fromDegrees(d.lon, d.lat, 2),
                box: { dimensions: new Cesium.Cartesian3(2.2, 2.2, 1.6), material: css('#0ea5e9', 0.85), outline: true, outlineColor: Cesium.Color.WHITE },
                label: { text: new Cesium.CallbackProperty(() => { const l = liveRef.current[d.id]; return `⬡ ${d.name}\n${DOCK_STATE_LABELS[l?.state] || '대기'} · ${l?.battery ?? '-'}%`; }, false), font: '10.5px "Noto Sans KR", sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -24), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000), disableDepthTestDistance: FAR },
                properties: { _layerType: 'droneOps', _industrialType: 'dock', _industrialId: d.id, 기종: d.model },
            });
            // 임무 중 기체 (데모: 단지 중심 주변 순찰 궤적)
            if (site) {
                const center = { lon: (site.lon + d.lon) / 2, lat: (site.lat + d.lat) / 2 };
                const pos = new Cesium.CallbackProperty((time) => {
                    const l = liveRef.current[d.id];
                    if (!l || l.state !== 'IN_MISSION') return undefined;
                    const t = Cesium.JulianDate.secondsDifference(time, Cesium.JulianDate.fromDate(new Date(0))) / 60;
                    const r = 0.0028;
                    return Cesium.Cartesian3.fromDegrees(center.lon + Math.cos(t) * r * 1.3, center.lat + Math.sin(t) * r, 60);
                }, false);
                ds.entities.add({
                    id: `gi-uav-${d.id}`,
                    name: `${d.name} 기체`,
                    position: pos,
                    point: { pixelSize: 10, color: css('#38bdf8'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: FAR },
                    label: { text: '✈ 임무 비행 중 (60 m)', font: '10px "Noto Sans KR", sans-serif', fillColor: css('#7dd3fc'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), disableDepthTestDistance: FAR },
                    properties: { _layerType: 'droneOps', _industrialType: 'dock', _industrialId: d.id, 상태: '임무 비행 중' },
                });
            }
        });
        photos.forEach((p) => {
            if (p.lat == null) return;
            const color = p.kind === 'thermal' ? '#f97316' : p.kind === 'wide' ? '#a78bfa' : '#38bdf8';
            ds.entities.add({
                id: `gi-photo-${p.id}`,
                name: p.name,
                position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(2, p.relativeAltitude || 0)),
                point: { pixelSize: 5, color: css(color, 0.9), outlineColor: Cesium.Color.BLACK.withAlpha(0.5), outlineWidth: 1, disableDepthTestDistance: FAR, scaleByDistance: new Cesium.NearFarScalar(300, 1.4, 5000, 0.5) },
                properties: { _layerType: 'droneOps', _industrialType: 'photo', _industrialId: p.id, 종류: p.kind === 'thermal' ? '열화상' : '가시광', 촬영: p.takenAt, 고도: p.relativeAltitude != null ? `${p.relativeAltitude} m` : '-' },
            });
        });
        update('droneOps', [...docks, ...photos.filter((p) => p.lat != null)], { sourceName: '드론 운용' });
    }, [enabled, docks, photos, site, dsRef, update]);
    return null;
}

// ── 열화상 그리드 → 캔버스 ────────────────────────────────
function renderThermalCanvas(grid, { palette = 'ironbow', min, max }) {
    const { width, height } = grid;
    const bytes = Uint8Array.from(atob(grid.data), (c) => c.charCodeAt(0));
    const temps = new Float32Array(bytes.buffer);
    const lo = Number.isFinite(min) ? min : grid.min;
    const hi = Number.isFinite(max) ? max : grid.max;
    const span = hi - lo || 1;
    const stops = THERMAL_PALETTES[palette] || THERMAL_PALETTES.ironbow;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < temps.length; i++) {
        const t = temps[i];
        const o = i * 4;
        if (!Number.isFinite(t)) { img.data[o + 3] = 0; continue; }
        const f = Math.min(1, Math.max(0, (t - lo) / span));
        const x = f * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(x));
        const r = x - k;
        img.data[o] = stops[k][0] + (stops[k + 1][0] - stops[k][0]) * r;
        img.data[o + 1] = stops[k][1] + (stops[k + 1][1] - stops[k][1]) * r;
        img.data[o + 2] = stops[k][2] + (stops[k + 1][2] - stops[k][2]) * r;
        img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

// ── 영상 오버레이 (정사영상 타일/미리보기 · 열화상) ────────
export function ImageryOverlays({ viewer }) {
    const enabled = useStore((s) => s.layers.imagery?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const datasets = useIndustrialStore((s) => s.datasets);
    const overlayState = useIndustrialStore((s) => s.overlayState);
    const thermal = useIndustrialStore((s) => s.thermal);
    const layersRef = useRef(new Map()); // key -> {layer, kind, pending}
    const wantedRef = useRef(new Map());
    const gridCache = useRef(new Map());

    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return undefined;
        const wanted = new Map();
        if (enabled) {
            datasets.forEach((ds) => {
                const st = overlayState[ds.id];
                if (!st?.visible) return;
                if (ds.type === 'thermal') {
                    // Terra 등 외부 팔레트 타일이 있으면 기본은 타일(원해상도), 옵션으로 온도 그리드 컬러맵
                    if (ds.tilesUrl && ds.bounds && st.mode !== 'grid') wanted.set(`${ds.id}:tiles`, { ds, kind: 'tiles', opacity: thermal.opacity });
                    else wanted.set(`${ds.id}:thermal:${thermal.palette}:${thermal.min}:${thermal.max}`, { ds, kind: 'thermal', opacity: thermal.opacity });
                } else if (['orthophoto', 'satellite', 'ndvi', 'dsm'].includes(ds.type)) {
                    if (ds.tilesStatus === 'ready' && ds.tilesUrl && ds.bounds) wanted.set(`${ds.id}:tiles`, { ds, kind: 'tiles', opacity: st.opacity ?? 1 });
                    else if (ds.previewUrl && (ds.previewBounds || ds.bounds)) wanted.set(`${ds.id}:preview`, { ds, kind: 'preview', opacity: st.opacity ?? 1 });
                }
            });
        }
        wantedRef.current = wanted;
        // 제거 (로딩 중인 항목은 완료 시점에 wantedRef로 재확인)
        for (const [key, entry] of layersRef.current.entries()) {
            if (!wanted.has(key)) {
                if (entry.layer) { try { viewer.imageryLayers.remove(entry.layer, true); } catch { /* ignore */ } }
                layersRef.current.delete(key);
            }
        }
        // 추가/갱신
        wanted.forEach(async ({ ds, kind, opacity }, key) => {
            const existing = layersRef.current.get(key);
            if (existing) { if (existing.layer) existing.layer.alpha = opacity; return; }
            const entry = { layer: null, kind, pending: true };
            layersRef.current.set(key, entry);
            try {
                let provider = null;
                if (kind === 'tiles') {
                    const b = ds.bounds;
                    provider = new Cesium.UrlTemplateImageryProvider({ url: api.url(ds.tilesUrl), minimumLevel: ds.minZoom || 12, maximumLevel: ds.maxZoom || 19, rectangle: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north), hasAlphaChannel: true, credit: ds.name });
                } else if (kind === 'preview') {
                    const b = ds.previewBounds || ds.bounds;
                    provider = await Cesium.SingleTileImageryProvider.fromUrl(api.url(ds.previewUrl), { rectangle: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north), credit: ds.name });
                } else if (kind === 'thermal') {
                    let grid = gridCache.current.get(ds.id);
                    if (!grid) {
                        grid = await api.get(`/api/datasets/${ds.id}/thermal-grid?maxDim=1024`);
                        gridCache.current.set(ds.id, grid);
                        useIndustrialStore.setState((s) => ({ thermalRange: { ...(s.thermalRange || {}), [ds.id]: { min: grid.min, max: grid.max } } }));
                    }
                    const canvas = renderThermalCanvas(grid, thermal);
                    const b = grid.bounds;
                    provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), { rectangle: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north), credit: ds.name });
                }
                const stillWanted = wantedRef.current.has(key) && layersRef.current.get(key) === entry;
                if (!provider || viewer.isDestroyed() || !stillWanted) {
                    if (layersRef.current.get(key) === entry) layersRef.current.delete(key);
                    return;
                }
                const layer = viewer.imageryLayers.addImageryProvider(provider);
                layer.alpha = wantedRef.current.get(key)?.opacity ?? opacity;
                entry.layer = layer;
                entry.pending = false;
                viewer.scene.requestRender();
            } catch (err) {
                console.warn('[imagery]', ds.name, err.message);
                if (layersRef.current.get(key) === entry) layersRef.current.delete(key);
            }
        });
        update('imagery', Array.from(wanted.values()).map((w) => w.ds), { sourceName: '정사영상/열화상' });
        return undefined;
    }, [viewer, enabled, datasets, overlayState, thermal, update]);

    useEffect(() => () => {
        if (!viewer || viewer.isDestroyed()) return;
        for (const entry of layersRef.current.values()) if (entry.layer) viewer.imageryLayers.remove(entry.layer, true);
        layersRef.current.clear();
    }, [viewer]);
    return null;
}

// ── 3D Tiles ────────────────────────────────────────────
export function Tiles3DLayer({ viewer }) {
    const enabled = useStore((s) => s.layers.tiles3d?.enabled);
    const update = useStore((s) => s.updateLayerData);
    const datasets = useIndustrialStore((s) => s.datasets);
    const overlayState = useIndustrialStore((s) => s.overlayState);
    const heightOffset = useIndustrialStore((s) => s.twin?.tilesHeightOffset);
    const tilesLod = useIndustrialStore((s) => s.twin?.tilesLod);
    const tilesRef = useRef(new Map());

    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return;
        window.__giViewer = viewer; // 진단용
        const wanted = enabled ? datasets.filter((d) => (d.type === '3dtiles' || d.type === 'pointcloud') && d.tilesetUrl && overlayState[d.id]?.visible) : [];
        for (const [id, entry] of tilesRef.current.entries()) {
            if (!wanted.find((d) => d.id === id)) {
                try { viewer.scene.primitives.remove(entry.tileset); } catch { /* ignore */ }
                tilesRef.current.delete(id);
            }
        }
        wanted.forEach(async (ds) => {
            if (tilesRef.current.has(ds.id)) return;
            tilesRef.current.set(ds.id, { pending: true });
            try {
                const tileset = await Cesium.Cesium3DTileset.fromUrl(api.url(ds.tilesetUrl), {
                    // 멀리서도 바로 상세 메시가 보이도록: 낮은 SSE, 거리 기반 품질 저하(dynamic SSE) 끔, 비행 목적지 선로딩
                    maximumScreenSpaceError: lodFor(ds.type, useIndustrialStore.getState().twin?.tilesLod, false),
                    skipLevelOfDetail: false,
                    dynamicScreenSpaceError: false,
                    foveatedScreenSpaceError: false,
                    cullRequestsWhileMoving: false,
                    preloadFlightDestinations: true,
                    preloadWhenHidden: true,
                    maximumCacheOverflowBytes: 1024 * 1024 * 1024,
                    pointCloudShading: ds.type === 'pointcloud' ? { attenuation: true, maximumAttenuation: 4, eyeDomeLighting: true } : undefined,
                });
                if (viewer.isDestroyed()) return;
                if (ds.type === 'pointcloud') tileset.style = new Cesium.Cesium3DTileStyle({ pointSize: 3 });
                // DJI Terra 타일셋은 중간 노드의 geometricError가 비정상(1e10)이라 원거리에서 최상위 4타일만 선택된다.
                // 노드 수가 적은(≤3000) 실측 타일셋은 전체를 받아도 가벼우므로 SSE를 1/4로 낮춰 멀리서도 바로 상세 메시를 보여준다.
                const small = countTiles(tileset.root, 3001) <= 3000;
                tileset.maximumScreenSpaceError = lodFor(ds.type, useIndustrialStore.getState().twin?.tilesLod, small);
                // 지면 정합: 타원체(평지) 지형 위에 실측 모델이 떠 보이지 않도록 중심 높이를 보정
                const center = tileset.boundingSphere.center;
                const carto = Cesium.Cartographic.fromCartesian(center);
                const auto = -(carto.height - 35);
                entryOffset(tileset, carto, Number.isFinite(heightOffset) ? heightOffset : auto);
                useIndustrialStore.setState((s) => ({ twin: { ...(s.twin || {}), tilesAutoOffset: Math.round(auto), tilesHeightOffset: Number.isFinite(s.twin?.tilesHeightOffset) ? s.twin.tilesHeightOffset : Math.round(auto) } }));
                viewer.scene.primitives.add(tileset);
                tilesRef.current.set(ds.id, { tileset, carto, type: ds.type, small });
                viewer.scene.requestRender();
            } catch (err) {
                console.warn('[3dtiles]', ds.name, err.message);
                tilesRef.current.delete(ds.id);
            }
        });
        update('tiles3d', wanted, { sourceName: '실측 3D Tiles' });
    }, [viewer, enabled, datasets, overlayState, update]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!Number.isFinite(heightOffset)) return;
        for (const entry of tilesRef.current.values()) if (entry.tileset) entryOffset(entry.tileset, entry.carto, heightOffset);
        viewer?.scene?.requestRender();
    }, [heightOffset, viewer]);

    // 상세도(LOD) 슬라이더 반영
    useEffect(() => {
        for (const entry of tilesRef.current.values()) if (entry.tileset) entry.tileset.maximumScreenSpaceError = lodFor(entry.type, tilesLod, entry.small);
        viewer?.scene?.requestRender();
    }, [tilesLod, viewer]);

    useEffect(() => () => {
        if (!viewer || viewer.isDestroyed()) return;
        for (const entry of tilesRef.current.values()) if (entry.tileset) viewer.scene.primitives.remove(entry.tileset);
        tilesRef.current.clear();
    }, [viewer]);
    return null;
}

// 상세도 → Cesium maximumScreenSpaceError (b3dm 기본 2, 포인트클라우드는 4배 완화)
function lodFor(type, lod, small) {
    const base = Number.isFinite(lod) && lod > 0 ? lod : 2;
    if (type === 'pointcloud') return base * 4;
    return small ? base / 4 : base;
}

function countTiles(tile, limit) {
    let n = 0;
    const stack = [tile];
    while (stack.length && n < limit) {
        const t = stack.pop();
        if (!t) continue;
        n++;
        if (t.children) for (const c of t.children) stack.push(c);
    }
    return n;
}

function entryOffset(tileset, carto, offsetM) {
    const surface = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
    const offset = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, offsetM);
    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
}

// ── 카메라 제어 (flyTo 요청 · 사이트 초기 이동) ─────────────
export function CameraController({ viewer }) {
    const flyRequest = useIndustrialStore((s) => s.flyRequest);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const sites = useIndustrialStore((s) => s.sites);
    const setAutoRotating = useStore((s) => s.setAutoRotating);
    const initialRef = useRef(false);

    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !flyRequest) return;
        setAutoRotating(false);
        flyToTarget(viewer, flyRequest);
    }, [flyRequest, viewer, setAutoRotating]);

    useEffect(() => {
        if (initialRef.current || !viewer || viewer.isDestroyed()) return;
        const site = sites.find((s) => s.id === activeSiteId);
        if (!site) return;
        initialRef.current = true;
        setAutoRotating(false);
        setTimeout(() => {
            if (viewer.isDestroyed()) return;
            flyToTarget(viewer, { lon: site.lon, lat: site.lat, height: site.cameraHeight || 2500, pitch: -50, heading: 0, duration: 2.5 });
        }, 600);
    }, [viewer, sites, activeSiteId, setAutoRotating]);
    return null;
}

// 목표 지점이 화면 중앙에 오도록 (높이·피치로 거리 계산) 비행
export function flyToTarget(viewer, { lon, lat, height = 500, pitch = -50, heading, duration = 1.6, groundHeight = 0 }) {
    const pitchRad = Cesium.Math.toRadians(Math.min(-5, Math.max(-89.9, pitch)));
    const range = height / Math.sin(-pitchRad);
    const headingRad = Cesium.Math.toRadians(heading ?? Cesium.Math.toDegrees(viewer.camera.heading));
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, groundHeight);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
        offset: new Cesium.HeadingPitchRange(headingRad, pitchRad, range),
        duration,
    });
}

// ── 폴리곤 그리기 도구 (PV 어레이 / 시설) ─────────────────
// 좌클릭: 점 추가 · 우클릭 또는 더블클릭: 완료 · Esc: 취소
export function DrawTool({ viewer }) {
    const drawMode = useIndustrialStore((s) => s.drawMode);
    const dsRef = useEntityCollection(viewer, 'gi-draw');
    const pointsRef = useRef([]);

    useEffect(() => {
        const ds = dsRef.current;
        if (!viewer || viewer.isDestroyed() || !ds) return undefined;
        ds.entities.removeAll();
        pointsRef.current = [];
        if (!drawMode) return undefined;

        const color = drawMode === 'panelArray' ? '#22c55e' : '#60a5fa';
        const positionsCb = new Cesium.CallbackProperty(() => pointsRef.current.map((p) => Cesium.Cartesian3.fromDegrees(p[0], p[1], 2)), false);
        ds.entities.add({ id: 'gi-draw-line', polyline: { positions: positionsCb, width: 2.5, material: css(color, 0.95), clampToGround: false, disableDepthTestDistance: FAR } });
        ds.entities.add({ id: 'gi-draw-poly', polygon: { hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(pointsRef.current.length >= 3 ? pointsRef.current.map((p) => Cesium.Cartesian3.fromDegrees(p[0], p[1], 1)) : []), false), material: css(color, 0.25), height: 1 } });

        const pickLonLat = (pos) => {
            const scene = viewer.scene;
            let cart = null;
            if (scene.pickPositionSupported) {
                const picked = scene.pickPosition(pos);
                if (picked && Cesium.Cartesian3.magnitude(picked) > 0) cart = picked;
            }
            if (!cart) cart = viewer.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
            if (!cart) return null;
            const c = Cesium.Cartographic.fromCartesian(cart);
            return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
        };
        const addVertex = (ll) => {
            pointsRef.current = [...pointsRef.current, ll];
            ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(ll[0], ll[1], 2), point: { pixelSize: 7, color: Cesium.Color.WHITE, outlineColor: css(color), outlineWidth: 2, disableDepthTestDistance: FAR } });
            viewer.scene.requestRender();
        };
        const finish = async () => {
            const pts = pointsRef.current;
            if (pts.length < 3) { useIndustrialStore.getState().setDrawMode(null); return; }
            const ring = [...pts, pts[0]];
            const name = window.prompt(drawMode === 'panelArray' ? 'PV 어레이 이름' : '시설(건물) 이름', drawMode === 'panelArray' ? '옥상 PV' : '신규 시설');
            if (name === null) { useIndustrialStore.getState().setDrawMode(null); return; }
            const st = useIndustrialStore.getState();
            const c = ring.slice(0, -1).reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
            try {
                if (drawMode === 'panelArray') {
                    const fac = st.facilities.find((f) => f.geometry?.coordinates && pointInRing(c[0], c[1], f.geometry.coordinates[0]));
                    await api.post('/api/panelArrays', { siteId: st.activeSiteId, facilityId: fac?.id || null, name, geometry: { type: 'Polygon', coordinates: [ring] }, moduleWp: 550, tiltDeg: 10, azimuthDeg: 180, inverterCount: 1, installedAt: new Date().toISOString().slice(0, 10), lastCleaning: null, health: { status: 'normal', healthFactor: 1, hotspotCount: 0 }, drawn: true });
                    await st.refreshCollection('panelArrays');
                } else {
                    await api.post('/api/facilities', { siteId: st.activeSiteId, name, company: name, type: 'factory', typeLabel: '제조공장', lotNo: `${st.sites.find((s) => s.id === st.activeSiteId)?.code || 'NEW'}-${Date.now().toString().slice(-4)}`, lon: c[0], lat: c[1], floors: 1, heightM: 9, roofType: 'steel', geometry: { type: 'Polygon', coordinates: [ring] }, status: 'operating', hazard: '없음', employees: 0, energyKwhMonth: 0, pvInstalled: false, riskScore: 10, lastInspection: new Date().toISOString().slice(0, 10), drawn: true });
                    await st.refreshCollection('facilities');
                }
                st.refreshSummary();
            } catch (err) {
                window.alert(`저장 실패: ${err.message}`);
            }
            st.setDrawMode(null);
        };

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((e) => { const ll = pickLonLat(e.position); if (ll) addVertex(ll); }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(() => finish(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
        handler.setInputAction(() => finish(), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        const onKey = (e) => { if (e.key === 'Escape') useIndustrialStore.getState().setDrawMode(null); if (e.key === 'Enter') finish(); };
        window.addEventListener('keydown', onKey);
        viewer.scene.canvas.style.cursor = 'crosshair';
        return () => {
            handler.destroy();
            window.removeEventListener('keydown', onKey);
            viewer.scene.canvas.style.cursor = '';
            ds.entities.removeAll();
        };
    }, [viewer, drawMode, dsRef]);
    return null;
}

function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

export default function IndustrialLayers({ viewer }) {
    return (
        <>
            <CameraController viewer={viewer} />
            <DrawTool viewer={viewer} />
            <ImageryOverlays viewer={viewer} />
            <Tiles3DLayer viewer={viewer} />
            <SitesLayer viewer={viewer} />
            <CadastralLayer viewer={viewer} />
            <LotPicker viewer={viewer} />
            <DrawingsLayer viewer={viewer} />
            <ParcelsLayer viewer={viewer} />
            <FacilitiesLayer viewer={viewer} />
            <SolarPanelsLayer viewer={viewer} />
            <HotspotsLayer viewer={viewer} />
            <SensorsLayer viewer={viewer} />
            <DroneLayer viewer={viewer} />
        </>
    );
}
