// 주소·필지(지적도식) 레이어 + 도면(SHP/DXF) 중첩 레이어
import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import useIndustrialStore from '../store';
import { api } from '../api';
import { FACILITY_COLORS } from '../constants';

const css = (hex, alpha = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
const FAR = Number.POSITIVE_INFINITY;
const SOURCE_COLOR = { cadastral: '#38bdf8', osm: '#a78bfa', approx: '#fbbf24', none: '#6b7280' };

function useDataSource(viewer, name) {
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

const ringCenter = (ring) => {
    let x = 0;
    let y = 0;
    const n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
};

// ── 필지(지적도식) ───────────────────────────────────────
export function ParcelsLayer({ viewer }) {
    const parcels = useIndustrialStore((s) => s.parcels);
    const ui = useIndustrialStore((s) => s.parcelUi);
    const selected = useIndustrialStore((s) => s.selected);
    const dsRef = useDataSource(viewer, 'gi-parcels');
    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.suspendEvents();
        ds.entities.removeAll();
        if (ui.visible) {
            parcels.forEach((p) => {
                const ring = p.geometry?.coordinates?.[0];
                if (!ring || ring.length < 4) return;
                const isSel = selected?.type === 'parcel' && selected.id === p.id;
                const base = FACILITY_COLORS[p.category] || (p.facilityId ? '#22c55e' : SOURCE_COLOR[p.geometrySource] || '#94a3b8');
                const props = { _layerType: 'facilities', _industrialType: 'parcel', _industrialId: p.id, 주소: p.address, 업체: p.company || p.name || '-', 면적: p.areaSqm ? `${Math.round(p.areaSqm)} ㎡` : '-' };
                ds.entities.add({
                    id: `gi-parcel-${p.id}`,
                    name: p.name || p.address,
                    polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()), material: css(base, isSel ? 0.55 : p.company ? 0.4 : p.geometrySource === 'approx' ? 0.14 : 0.2), classificationType: Cesium.ClassificationType.BOTH },
                    properties: props,
                });
                ds.entities.add({
                    id: `gi-parcel-line-${p.id}`,
                    polyline: {
                        positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
                        width: isSel ? 4 : p.company ? 3.2 : 1.6,
                        material: p.geometrySource === 'approx' && !isSel ? new Cesium.PolylineDashMaterialProperty({ color: css(base, 0.95), dashLength: 10 }) : css(isSel ? '#ffffff' : base, 0.95),
                        clampToGround: true,
                    },
                    properties: props,
                });
                if (p.lon != null) {
                    ds.entities.add({
                        id: `gi-parcel-pt-${p.id}`,
                        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 8),
                        point: { pixelSize: isSel ? 11 : 7, color: css(base, 0.95), outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(1200, FAR), disableDepthTestDistance: FAR },
                        properties: props,
                    });
                }
                if (ui.labels && p.lon != null) {
                    const [cx, cy] = ringCenter(ring);
                    ds.entities.add({
                        id: `gi-parcel-label-${p.id}`,
                        position: Cesium.Cartesian3.fromDegrees(cx, cy, 6),
                        label: { text: String(p.company || p.name || p.lotNo || p.address || '').replace('(주)', '').slice(0, 14) + (p.floors ? `\n${p.floors}층${p.usageName ? ' · ' + p.usageName : ''}` : ''), font: '600 11px "Noto Sans KR", sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800), disableDepthTestDistance: FAR, scaleByDistance: new Cesium.NearFarScalar(200, 1.1, 1800, 0.65) },
                        properties: props,
                    });
                }
            });
        }
        ds.entities.resumeEvents();
        viewer?.scene?.requestRender();
    }, [parcels, ui, selected, dsRef, viewer]);
    return null;
}

// ── 도면 중첩 (SHP / DXF → GeoJSON) ─────────────────────────
const geojsonCache = new Map();
function loadGeoJson(d) {
    const key = `${d.id}|${d.geojsonRev || 0}`;
    if (!geojsonCache.has(key)) {
        geojsonCache.set(key, api.get(`/api/drawings/${d.id}/geojson`).catch((err) => { geojsonCache.delete(key); throw err; }));
        for (const k of geojsonCache.keys()) if (k.startsWith(`${d.id}|`) && k !== key) geojsonCache.delete(k);
    }
    return geojsonCache.get(key);
}

const LABEL_FIELDS = ['Text', 'text', '지번', 'JIBUN', 'jibun', 'PNU', '주소', 'ADDR', '명칭', 'NAME', 'name', '건물명', '번호'];
const MAX_FEATURES = 40000;
const CHUNK = 2000;

function styleKey(d) {
    return [d.id, d.geojsonRev, d.visible, d.color, d.opacity, d.lineWidth, d.clamp, d.fill, d.useSourceColors, d.showLabels, d.labelField, (d.hiddenLayers || []).join(',')].join('|');
}

function buildDrawing(viewer, d, gj) {
    const prims = [];
    const labels = new Cesium.LabelCollection({ scene: viewer.scene });
    const hidden = new Set(d.hiddenLayers || []);
    const feats = gj.features.slice(0, MAX_FEATURES);
    const clamp = d.clamp !== false;
    const useSrc = d.useSourceColors !== false && d.kind === 'dxf';
    const colorOf = (f) => {
        let hex = useSrc && f.properties?._c ? f.properties._c : d.color;
        if (hex === '#000000') hex = '#ffffff'; // 검정(DXF 7번 색)은 어두운 지도에서 안 보이므로 흰색으로
        return hex;
    };
    const lineInst = [];
    const fillInst = [];
    const groundOk = clamp && Cesium.GroundPolylinePrimitive.isSupported(viewer.scene);
    let labelCount = 0;
    const labelField = d.labelField || LABEL_FIELDS.find((k) => feats.some((f) => f.properties?.[k] != null && f.properties[k] !== ''));

    const addLine = (coords, color) => {
        const pts = [];
        coords.forEach(([lon, lat], i) => { if (!i || lon !== coords[i - 1][0] || lat !== coords[i - 1][1]) pts.push(lon, lat); });
        if (pts.length < 4) return;
        const positions = Cesium.Cartesian3.fromDegreesArray(pts);
        const attributes = { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) };
        lineInst.push(new Cesium.GeometryInstance({
            geometry: groundOk ? new Cesium.GroundPolylineGeometry({ positions, width: d.lineWidth || 1.5 }) : new Cesium.PolylineGeometry({ positions, width: d.lineWidth || 1.5, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
            attributes,
        }));
    };
    const addFill = (poly, color) => {
        if (fillInst.length > 6000) return;
        const outer = Cesium.Cartesian3.fromDegreesArray(poly[0].flat());
        const holes = poly.slice(1).map((r) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(r.flat())));
        fillInst.push(new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes), vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(Math.min(0.5, (d.opacity ?? 0.85) * 0.28))) },
        }));
    };
    const addLabel = (lon, lat, text, hex) => {
        if (labelCount >= 3000 || !text) return;
        labelCount++;
        labels.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 4), text: String(text).slice(0, 24), font: '600 12px "Noto Sans KR", sans-serif', fillColor: css(hex, 1), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1600), disableDepthTestDistance: FAR });
    };

    for (const f of feats) {
        const p = f.properties || {};
        if (hidden.has(String(p.Layer ?? p.layer ?? '0'))) continue;
        const hex = colorOf(f);
        const color = css(hex, d.opacity ?? 0.85);
        const g = f.geometry;
        const labelText = d.showLabels !== false && labelField ? p[labelField] : null;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null;
        const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPoint' ? g.coordinates : null;
        if (polys) {
            polys.forEach((poly) => {
                poly.forEach((ring) => addLine(ring, color));
                if (d.fill !== false && poly[0]?.length >= 4) addFill(poly, css(hex, 1));
                if (labelText) { const [cx, cy] = ringCenter(poly[0]); addLabel(cx, cy, labelText, hex); }
            });
        } else if (lines) {
            lines.forEach((l) => addLine(l, color));
            if (labelText && lines[0]?.length) { const m = lines[0][Math.floor(lines[0].length / 2)]; addLabel(m[0], m[1], labelText, hex); }
        } else if (pts) {
            pts.forEach(([lon, lat]) => {
                if (labelText) addLabel(lon, lat, labelText, hex);
                else addLabel(lon, lat, '•', hex);
            });
        }
    }

    for (let i = 0; i < lineInst.length; i += CHUNK) {
        const geometryInstances = lineInst.slice(i, i + CHUNK);
        const appearance = new Cesium.PolylineColorAppearance();
        const prim = groundOk
            ? new Cesium.GroundPolylinePrimitive({ geometryInstances, appearance, classificationType: Cesium.ClassificationType.BOTH, asynchronous: true })
            : new Cesium.Primitive({ geometryInstances, appearance, asynchronous: true });
        prims.push(prim);
    }
    for (let i = 0; i < fillInst.length; i += CHUNK) {
        const geometryInstances = fillInst.slice(i, i + CHUNK);
        const appearance = new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true });
        prims.push(clamp
            ? new Cesium.GroundPrimitive({ geometryInstances, appearance, classificationType: Cesium.ClassificationType.BOTH, asynchronous: true })
            : new Cesium.Primitive({ geometryInstances, appearance, asynchronous: true }));
    }
    prims.forEach((p) => viewer.scene.primitives.add(p));
    viewer.scene.primitives.add(labels);
    return { prims, labels, truncated: gj.features.length > MAX_FEATURES };
}

export function DrawingsLayer({ viewer }) {
    const drawings = useIndustrialStore((s) => s.drawings);
    const builtRef = useRef(new Map()); // id -> {key, prims, labels}

    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return undefined;
        const built = builtRef.current;
        const ids = new Set(drawings.map((d) => d.id));
        const drop = (id) => {
            const b = built.get(id);
            if (!b) return;
            if (!viewer.isDestroyed()) {
                b.prims.forEach((p) => viewer.scene.primitives.remove(p));
                viewer.scene.primitives.remove(b.labels);
            }
            built.delete(id);
        };
        for (const id of [...built.keys()]) if (!ids.has(id)) drop(id);
        drawings.forEach((d) => {
            const key = styleKey(d);
            const cur = built.get(d.id);
            if (cur && cur.key === key) return;
            drop(d.id);
            if (!d.visible) return;
            built.set(d.id, { key, prims: [], labels: new Cesium.LabelCollection() }); // 중복 빌드 방지용 자리표시
            loadGeoJson(d).then((gj) => {
                if (viewer.isDestroyed()) return;
                const slot = built.get(d.id);
                if (!slot || slot.key !== key) return;
                const res = buildDrawing(viewer, d, gj);
                built.set(d.id, { key, ...res });
                viewer.scene.requestRender();
            }).catch((err) => {
                console.warn('[drawings]', d.name, err.message);
                const slot = built.get(d.id);
                if (slot && slot.key === key) built.delete(d.id);
            });
        });
        return undefined;
    }, [drawings, viewer]);

    useEffect(() => () => {
        const viewerAlive = viewer && !viewer.isDestroyed();
        for (const b of builtRef.current.values()) {
            if (!viewerAlive) continue;
            b.prims.forEach((p) => viewer.scene.primitives.remove(p));
            viewer.scene.primitives.remove(b.labels);
        }
        builtRef.current.clear();
    }, [viewer]);
    return null;
}

// 불러온 지적 필지 인덱스 (클릭 선택용)
const cadIndex = new Map(); // key -> {pnu, jibun, addr, poly:[rings], bbox}
const ptInRing = (lon, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
};
function indexFeatures(features) {
    for (const f of features) {
        const g = f.geometry;
        const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
        polys.forEach((poly, i) => {
            const ring = poly[0];
            if (!ring?.length) return;
            let w = 181; let so = 91; let e = -181; let n = -91;
            for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
            cadIndex.set(`${f.properties?.pnu || 'x'}#${i}`, { pnu: f.properties?.pnu, jibun: f.properties?.jibun, addr: f.properties?.addr, poly, bbox: [w, so, e, n] });
        });
    }
    if (cadIndex.size > 30000) for (const k of [...cadIndex.keys()].slice(0, 10000)) cadIndex.delete(k);
}
export function findLotAt(lon, lat) {
    for (const lot of cadIndex.values()) {
        const [w, so, e, n] = lot.bbox;
        if (lon < w || lon > e || lat < so || lat > n) continue;
        if (!ptInRing(lon, lat, lot.poly[0])) continue;
        if (lot.poly.slice(1).some((h) => ptInRing(lon, lat, h))) continue;
        return lot;
    }
    return null;
}
const lotCenter = (ring) => {
    let x = 0; let y = 0;
    const n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
    return [x / n, y / n];
};

// ── 연속지적도 (브이월드 벡터, 화면 범위 격자 단위로 불러와 3D 타일 위에 선으로 표시) ──────────
const CELL = 0.004; // 도 (약 350 m)
const CAD_STYLE = { id: 'cadastral', kind: 'cadastral', color: '#fde047', opacity: 0.95, lineWidth: 1.3, clamp: true, fill: false, showLabels: true, labelField: 'jibun', hiddenLayers: [] };

export function CadastralLayer({ viewer }) {
    const on = useIndustrialStore((s) => s.parcelUi.cadastral);
    const filledKey = useIndustrialStore((s) => s.parcels.filter((p) => p.pnu && p.company).map((p) => p.pnu).join(','));
    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !on) return undefined;
        const filled = new Set(filledKey ? filledKey.split(',') : []);
        const cells = new Map(); // key -> {prims, labels} | 'loading'
        const order = [];
        let timer = null;
        const clearCell = (k) => {
            const c = cells.get(k);
            if (c && c !== 'loading' && !viewer.isDestroyed()) {
                c.prims.forEach((p) => viewer.scene.primitives.remove(p));
                viewer.scene.primitives.remove(c.labels);
            }
            cells.delete(k);
        };
        const refresh = () => {
            if (viewer.isDestroyed()) return;
            const camHeight = viewer.camera.positionCartographic?.height ?? 1e9;
            if (camHeight > 1500) return; // 너무 멀면 불러오지 않음
            const rect = viewer.camera.computeViewRectangle();
            if (!rect) return;
            const deg = Cesium.Math.toDegrees;
            const w = deg(rect.west); const e = deg(rect.east); const so = deg(rect.south); const n = deg(rect.north);
            const cx0 = Math.floor(w / CELL); const cx1 = Math.floor(e / CELL); const cy0 = Math.floor(so / CELL); const cy1 = Math.floor(n / CELL);
            if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 16) return;
            for (let cx = cx0; cx <= cx1; cx++) {
                for (let cy = cy0; cy <= cy1; cy++) {
                    const key = cx + ':' + cy;
                    if (cells.has(key)) continue;
                    cells.set(key, 'loading');
                    const bbox = [cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL].map((v) => v.toFixed(6)).join(',');
                    api.get('/api/cadastral/features?bbox=' + bbox).then((gj) => {
                        if (viewer.isDestroyed() || cells.get(key) !== 'loading') return;
                        if (!gj.features?.length) { cells.set(key, { prims: [], labels: new Cesium.LabelCollection() }); return; }
                        indexFeatures(gj.features);
                        const view = { ...gj, features: gj.features.map((f) => ({ ...f, properties: { ...f.properties, label: filled.has(f.properties?.pnu) ? '' : f.properties?.jibun } })) };
                        const res = buildDrawing(viewer, { ...CAD_STYLE, labelField: 'label' }, view);
                        cells.set(key, res);
                        order.push(key);
                        while (order.length > 30) clearCell(order.shift());
                        viewer.scene.requestRender();
                    }).catch(() => cells.delete(key));
                }
            }
        };
        const onMove = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
        viewer.camera.moveEnd.addEventListener(onMove);
        onMove();
        return () => {
            clearTimeout(timer);
            if (!viewer.isDestroyed()) viewer.camera.moveEnd.removeEventListener(onMove);
            for (const k of [...cells.keys()]) clearCell(k);
        };
    }, [viewer, on, filledKey]);
    return null;
}

// ── 지적도 필지 클릭 선택 (상호 기입 모드) ───────────────────────
export function LotPicker({ viewer }) {
    const active = useIndustrialStore((s) => s.lotPick.active);
    const picked = useIndustrialStore((s) => s.lotPick.picked);
    const setLotPick = useIndustrialStore((s) => s.setLotPick);
    const dsRef = useDataSource(viewer, 'gi-lotpick');

    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !active) return undefined;
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        const canvas = viewer.scene.canvas;
        const prevCursor = canvas.style.cursor;
        canvas.style.cursor = 'crosshair';
        const locate = (pos) => {
            let c = null;
            const sp = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(pos) : null;
            if (sp) c = Cesium.Cartographic.fromCartesian(sp);
            else {
                const e = viewer.camera.pickEllipsoid(pos, viewer.scene.globe.ellipsoid);
                if (e) c = Cesium.Cartographic.fromCartesian(e);
            }
            return c ? [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)] : null;
        };
        const onClick = (additive) => (click) => {
            const ll = locate(click.position);
            if (!ll) return;
            const lot = findLotAt(ll[0], ll[1]);
            const cur = useIndustrialStore.getState().lotPick.picked;
            if (!lot) { setLotPick({ hint: '이 위치의 지적 필지를 찾지 못했습니다. 지도를 약 1 km 이하로 확대하고 지적도 표시를 켠 상태에서 눌러 주세요.' }); return; }
            const [lon, lat] = lotCenter(lot.poly[0]);
            const item = { key: `${lot.pnu}`, pnu: lot.pnu, jibun: lot.jibun, addr: lot.addr, polygon: lot.poly, lon, lat };
            const exists = cur.some((x) => x.key === item.key);
            const next = additive ? (exists ? cur.filter((x) => x.key !== item.key) : [...cur, item]) : exists && cur.length === 1 ? [] : [item];
            setLotPick({ picked: next, hint: null });
        };
        handler.setInputAction(onClick(false), Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(onClick(true), Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.SHIFT);
        handler.setInputAction(onClick(true), Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.CTRL);
        return () => {
            handler.destroy();
            if (!viewer.isDestroyed()) canvas.style.cursor = prevCursor;
        };
    }, [viewer, active, setLotPick]);

    useEffect(() => {
        const ds = dsRef.current;
        if (!ds) return;
        ds.entities.removeAll();
        picked.forEach((lot) => {
            const ring = lot.polygon[0];
            ds.entities.add({ polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flat()), material: css('#22d3ee', 0.4), classificationType: Cesium.ClassificationType.BOTH } });
            ds.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()), width: 4, material: css('#22d3ee', 1), clampToGround: true } });
        });
        viewer?.scene?.requestRender();
    }, [picked, dsRef, viewer]);
    return null;
}
