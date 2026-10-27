// 산업단지 관제 상태 (zustand) - 사이트/메뉴/데이터/실시간 텔레메트리
import { create } from 'zustand';
import { api } from './api';

const useIndustrialStore = create((set, get) => ({
    ready: false,
    error: null,
    sites: [],
    activeSiteId: localStorage.getItem('gi:activeSite') || null,
    activeMenu: localStorage.getItem('gi:activeMenu') || 'dashboard',
    panelOpen: true,

    facilities: [],
    parcels: [],
    drawings: [],
    lotPick: { active: false, picked: [], hint: null },
    parcelUi: { visible: true, labels: true, colorBy: 'source', cadastral: localStorage.getItem('gi:cadastral') === '1' },
    panelArrays: [],
    datasets: [],
    hotspots: [],
    loadError: null,
    alerts: [],
    sensors: [],
    docks: [],
    missions: [],
    photos: [],
    inspections: [],
    workOrders: [],
    summary: null,
    weather: null,
    airQuality: null,
    pvForecast: null,
    telemetry: null,
    jobs: [],
    systemStatus: null,

    // 오버레이 표시 상태 (datasetId -> {visible, opacity})
    overlayState: {},
    thermal: { palette: 'ironbow', min: null, max: null, opacity: 0.85, deltaThreshold: 15, absoluteThreshold: '' },
    thermalRange: {},
    twin: { heightScale: 1, hour: null, terrainExaggeration: 1, tilesHeightOffset: null, tilesAutoOffset: null, tilesLod: Number(localStorage.getItem('gi:tilesLod')) || 2 },
    selected: null, // {type, id}
    flyRequest: null, // {lon, lat, height, heading, pitch, token}
    highlightHotspotId: null,
    drawMode: null,

    setMenu: (id) => {
        localStorage.setItem('gi:activeMenu', id);
        set({ activeMenu: id, panelOpen: true });
    },
    togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
    setSelected: (selected) => set({ selected }),
    setDrawMode: (mode) => set({ drawMode: mode }),
    flyTo: (target) => set({ flyRequest: { ...target, token: Date.now() } }),
    setHighlightHotspot: (id) => set({ highlightHotspotId: id }),
    setLotPick: (patch) => set((s) => ({ lotPick: { ...s.lotPick, ...patch } })),
    setParcelUi: (patch) => set((s) => ({ parcelUi: { ...s.parcelUi, ...patch } })),
    setThermalOption: (patch) => set((s) => ({ thermal: { ...s.thermal, ...patch } })),
    setOverlay: (datasetId, patch) =>
        set((s) => ({ overlayState: { ...s.overlayState, [datasetId]: { visible: true, opacity: 1, ...(s.overlayState[datasetId] || {}), ...patch } } })),

    bootstrap: async () => {
        try {
            const sites = await api.get('/api/sites');
            let activeSiteId = get().activeSiteId;
            if (!sites.find((s) => s.id === activeSiteId)) activeSiteId = sites[0]?.id || null;
            set({ sites, activeSiteId, ready: true, error: null });
            if (activeSiteId) await get().loadSite(activeSiteId);
            api.get('/api/system/status').then((systemStatus) => set({ systemStatus })).catch(() => {});
            api.get('/api/jobs').then((jobs) => set({ jobs })).catch(() => {});
        } catch (err) {
            set({ error: err.message, ready: true });
        }
    },

    setActiveSite: async (siteId) => {
        localStorage.setItem('gi:activeSite', siteId);
        set((s) => ({ activeSiteId: siteId, selected: null, highlightHotspotId: null, telemetry: null, drawMode: null, twin: { ...s.twin, tilesHeightOffset: null, tilesAutoOffset: null } }));
        try {
            await get().loadSite(siteId);
        } catch (err) {
            set({ loadError: `${siteId}: ${err.message}` });
        }
        const site = get().sites.find((s) => s.id === siteId);
        if (site) get().flyTo({ lon: site.lon, lat: site.lat, height: site.cameraHeight || 2500, pitch: -50, heading: 0 });
    },

    loadSite: async (siteId) => {
        const q = `?siteId=${encodeURIComponent(siteId)}`;
        const [facilities, panelArrays, datasets, hotspots, alerts, sensors, docks, missions, inspections, workOrders, photos, parcels, drawings] = await Promise.all([
            api.get(`/api/facilities${q}`), api.get(`/api/panelArrays${q}`), api.get(`/api/datasets${q}`), api.get(`/api/hotspots${q}`),
            api.get(`/api/alerts${q}`), api.get(`/api/sensors${q}`), api.get(`/api/docks${q}`), api.get(`/api/missions${q}`),
            api.get(`/api/inspections${q}`), api.get(`/api/workOrders${q}`), api.get(`/api/photos${q}&limit=2000`),
            api.get(`/api/parcels${q}`).catch(() => []), api.get(`/api/drawings${q}`).catch(() => []),
        ]);
        const overlayState = { ...get().overlayState };
        datasets.forEach((d) => {
            if (!overlayState[d.id]) overlayState[d.id] = { visible: Boolean(d.visibleByDefault), opacity: d.type === 'thermal' ? 0.85 : 1 };
        });
        set({ facilities, parcels, drawings, panelArrays, datasets, hotspots, alerts, sensors, docks, missions, inspections, workOrders, photos, overlayState, loadError: null });
        get().refreshSummary(siteId);
        get().refreshEnvironment(siteId);
    },

    refreshSummary: async (siteId = get().activeSiteId) => {
        if (!siteId) return;
        try {
            set({ summary: await api.get(`/api/sites/${siteId}/summary`) });
        } catch {
            /* keep */
        }
    },
    refreshEnvironment: async (siteId = get().activeSiteId) => {
        if (!siteId) return;
        const [weather, airQuality, pvForecast] = await Promise.all([
            api.get(`/api/sites/${siteId}/weather`).catch((e) => ({ error: e.message })),
            api.get(`/api/sites/${siteId}/air-quality`).catch((e) => ({ error: e.message })),
            api.get(`/api/sites/${siteId}/pv-forecast`).catch((e) => ({ error: e.message })),
        ]);
        set({ weather, airQuality, pvForecast });
    },
    refreshCollection: async (name) => {
        const siteId = get().activeSiteId;
        if (!siteId) return;
        const path = name === 'hotspots' || name === 'photos' || name === 'inspections' || name === 'datasets' ? `/api/${name}` : `/api/${name}`;
        try {
            const rows = await api.get(`${path}?siteId=${encodeURIComponent(siteId)}${name === 'photos' ? '&limit=2000' : ''}`);
            set({ [name]: rows });
        } catch {
            /* keep */
        }
    },
    refreshSites: async () => {
        const sites = await api.get('/api/sites');
        set({ sites });
    },

    // SSE 핸들러
    onTelemetry: (payload) => {
        if (payload.siteId !== get().activeSiteId) return;
        set({ telemetry: payload });
    },
    onJob: (job) => set((s) => ({ jobs: [job, ...s.jobs.filter((j) => j.id !== job.id)].slice(0, 50) })),
    onDataset: (ds) => set((s) => (ds.siteId === s.activeSiteId ? { datasets: s.datasets.some((d) => d.id === ds.id) ? s.datasets.map((d) => (d.id === ds.id ? ds : d)) : [...s.datasets, ds] } : {})),
    onCollectionEvent: (name) => () => get().refreshCollection(name),

    ackAlert: async (id) => {
        await api.post(`/api/alerts/${id}/ack`, {});
        await get().refreshCollection('alerts');
        get().refreshSummary();
    },
}));

export default useIndustrialStore;
