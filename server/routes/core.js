// 사이트 / 시설물 / 태양광 어레이 / 센서 / 알림 / 작업지시 CRUD
import { Router } from 'express';
import { polygonAreaSqm } from '../lib/geo.js';
import { broadcast } from '../lib/sim.js';

export function coreRouter(store, sim) {
    const r = Router();

    const crud = (collection, { onChange } = {}) => {
        r.get(`/${collection}`, (req, res) => {
            const filter = {};
            if (req.query.siteId) filter.siteId = String(req.query.siteId);
            res.json(store.list(collection, Object.keys(filter).length ? filter : null));
        });
        r.get(`/${collection}/:id`, (req, res) => {
            const row = store.get(collection, req.params.id);
            if (!row) return res.status(404).json({ error: 'not found' });
            res.json(row);
        });
        r.post(`/${collection}`, (req, res) => {
            const row = store.insert(collection, req.body || {});
            onChange?.(row);
            broadcast(collection, { action: 'insert', row });
            res.status(201).json(row);
        });
        r.put(`/${collection}/:id`, (req, res) => {
            const row = store.update(collection, req.params.id, req.body || {});
            if (!row) return res.status(404).json({ error: 'not found' });
            onChange?.(row);
            broadcast(collection, { action: 'update', row });
            res.json(row);
        });
        r.delete(`/${collection}/:id`, (req, res) => {
            const ok = store.remove(collection, req.params.id);
            broadcast(collection, { action: 'delete', id: req.params.id });
            res.json({ ok });
        });
    };

    crud('sites');
    crud('facilities', { onChange: (row) => {
        if (row.geometry?.coordinates) store.update('facilities', row.id, { roofAreaSqm: Math.round(polygonAreaSqm(row.geometry.coordinates)) });
    } });
    crud('panelArrays', { onChange: (row) => {
        if (row.geometry?.coordinates) {
            const area = polygonAreaSqm(row.geometry.coordinates);
            const modules = row.moduleCount || Math.floor((area * 0.78) / 2.2);
            store.update('panelArrays', row.id, { areaSqm: Math.round(area), moduleCount: modules, capacityKwp: row.capacityKwp || Math.round(modules * 0.55 * 10) / 10 });
        }
    } });
    crud('sensors');
    crud('docks');
    crud('missions');
    crud('workOrders');
    crud('alerts');

    // 알림 확인 처리
    r.post('/alerts/:id/ack', (req, res) => {
        const row = store.update('alerts', req.params.id, { acknowledged: true, acknowledgedAt: new Date().toISOString(), acknowledgedBy: req.body?.by || 'operator' });
        if (!row) return res.status(404).json({ error: 'not found' });
        broadcast('alerts', { action: 'update', row });
        res.json(row);
    });

    // 사이트 요약 (대시보드 KPI)
    r.get('/sites/:id/summary', (req, res) => {
        const site = store.get('sites', req.params.id);
        if (!site) return res.status(404).json({ error: 'not found' });
        const siteId = site.id;
        const facilities = store.list('facilities', { siteId });
        const arrays = store.list('panelArrays', { siteId });
        const alerts = store.list('alerts', { siteId });
        const hotspots = store.list('hotspots', { siteId });
        const datasets = store.list('datasets', { siteId });
        const missions = store.list('missions', { siteId });
        const capacity = arrays.reduce((s, a) => s + (a.capacityKwp || 0), 0);
        const pvHistory = sim.history(`pv:site:${siteId}`);
        res.json({
            site,
            facilities: { total: facilities.length, operating: facilities.filter((f) => f.status === 'operating').length, vacant: facilities.filter((f) => f.type === 'vacant').length, withPv: facilities.filter((f) => f.pvInstalled).length, roofAreaSqm: facilities.reduce((s, f) => s + (f.roofAreaSqm || 0), 0) },
            pv: { arrays: arrays.length, capacityKwp: Math.round(capacity), modules: arrays.reduce((s, a) => s + (a.moduleCount || 0), 0), critical: arrays.filter((a) => a.health?.status === 'critical').length, warning: arrays.filter((a) => a.health?.status === 'warning').length, targetKwp: site.pvTargetKwp || 0, history: pvHistory.slice(-120) },
            thermal: { hotspots: hotspots.length, critical: hotspots.filter((h) => h.severity === 'critical').length, high: hotspots.filter((h) => h.severity === 'high').length, lastInspection: store.list('inspections', { siteId }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null },
            alerts: { open: alerts.filter((a) => !a.acknowledged).length, critical: alerts.filter((a) => !a.acknowledged && a.level === 'critical').length, recent: alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8) },
            datasets: { total: datasets.length, byType: datasets.reduce((m, d) => ({ ...m, [d.type]: (m[d.type] || 0) + 1 }), {}) },
            missions: { scheduled: missions.filter((m) => m.status === 'scheduled').length, completed: missions.filter((m) => m.status === 'completed').length, next: missions.filter((m) => m.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] || null },
        });
    });

    // 텔레메트리 히스토리
    r.get('/telemetry/history', (req, res) => {
        const key = String(req.query.key || '');
        res.json(sim.history(key));
    });

    return r;
}
