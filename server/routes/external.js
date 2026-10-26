// 외부 데이터: 사이트 기상/일사량, 대기질, 발전 추정, 보고서
import { Router } from 'express';
import { fetchWeather, fetchAirQuality, describeWeatherCode } from '../lib/external.js';
import { dailyEnergyKwh, instantPowerKw } from '../lib/pv.js';
import { setWeatherSnapshot } from '../lib/sim.js';

export function externalRouter(store) {
    const r = Router();

    r.get('/sites/:id/weather', async (req, res) => {
        const site = store.get('sites', req.params.id);
        if (!site) return res.status(404).json({ error: 'not found' });
        try {
            const wx = await fetchWeather(site.lat, site.lon);
            const c = wx.current || {};
            setWeatherSnapshot(site.id, { ghi: c.shortwave_radiation, temperature: c.temperature_2m, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m });
            const droneGo = (c.wind_gusts_10m ?? c.wind_speed_10m ?? 0) < 12 && (c.precipitation ?? 0) < 0.5 && ![45, 48, 95, 96, 99].includes(c.weather_code);
            res.json({ ...wx, description: describeWeatherCode(c.weather_code), droneFlightOk: droneGo, droneLimit: { maxGustMs: 12, maxPrecipMm: 0.5 } });
        } catch (err) {
            res.status(502).json({ error: `기상 API 실패: ${err.message}` });
        }
    });

    r.get('/sites/:id/air-quality', async (req, res) => {
        const site = store.get('sites', req.params.id);
        if (!site) return res.status(404).json({ error: 'not found' });
        try {
            res.json(await fetchAirQuality(site.lat, site.lon));
        } catch (err) {
            res.status(502).json({ error: `대기질 API 실패: ${err.message}` });
        }
    });

    // 태양광 발전 추정 (어레이별 오늘/내일 예상 발전량)
    r.get('/sites/:id/pv-forecast', async (req, res) => {
        const site = store.get('sites', req.params.id);
        if (!site) return res.status(404).json({ error: 'not found' });
        const arrays = store.list('panelArrays', { siteId: site.id });
        let hourly = null;
        let current = null;
        try {
            const wx = await fetchWeather(site.lat, site.lon);
            hourly = wx.hourly;
            current = wx.current;
        } catch {
            hourly = null;
        }
        const rows = arrays.map((a) => {
            const health = a.health?.healthFactor ?? 1;
            const daily = hourly ? dailyEnergyKwh(a, hourly, health) : { todayKwh: Math.round(a.capacityKwp * 3.6 * health * 10) / 10, tomorrowKwh: Math.round(a.capacityKwp * 3.6 * health * 10) / 10, series: [] };
            const ideal = hourly ? dailyEnergyKwh(a, hourly, 1) : { todayKwh: Math.round(a.capacityKwp * 3.6 * 10) / 10 };
            return {
                arrayId: a.id, name: a.name, facilityId: a.facilityId, capacityKwp: a.capacityKwp, health: a.health,
                nowKw: Math.round(instantPowerKw({ capacityKwp: a.capacityKwp, ghi: current?.shortwave_radiation ?? 0, ambientC: current?.temperature_2m ?? 20, healthFactor: health }) * 10) / 10,
                todayKwh: daily.todayKwh, tomorrowKwh: daily.tomorrowKwh,
                lossKwh: Math.round((ideal.todayKwh - daily.todayKwh) * 10) / 10,
                series: daily.series,
            };
        });
        const total = rows.reduce((m, x) => ({ nowKw: m.nowKw + x.nowKw, todayKwh: m.todayKwh + x.todayKwh, tomorrowKwh: m.tomorrowKwh + x.tomorrowKwh, lossKwh: m.lossKwh + x.lossKwh, capacityKwp: m.capacityKwp + x.capacityKwp }), { nowKw: 0, todayKwh: 0, tomorrowKwh: 0, lossKwh: 0, capacityKwp: 0 });
        Object.keys(total).forEach((k) => { total[k] = Math.round(total[k] * 10) / 10; });
        res.json({ siteId: site.id, source: hourly ? 'open-meteo' : 'fallback', current: current ? { ghi: current.shortwave_radiation, temperature: current.temperature_2m, cloud: current.cloud_cover } : null, total, arrays: rows, co2SavedKgToday: Math.round(total.todayKwh * 0.4594), revenueKrwToday: Math.round(total.todayKwh * 160) });
    });

    // 종합 보고서 (JSON) - 클라이언트에서 인쇄용 HTML로 렌더
    r.get('/sites/:id/report', async (req, res) => {
        const site = store.get('sites', req.params.id);
        if (!site) return res.status(404).json({ error: 'not found' });
        const siteId = site.id;
        const facilities = store.list('facilities', { siteId });
        const arrays = store.list('panelArrays', { siteId });
        const hotspots = store.list('hotspots', { siteId });
        const alerts = store.list('alerts', { siteId });
        const inspections = store.list('inspections', { siteId }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const missions = store.list('missions', { siteId });
        const datasets = store.list('datasets', { siteId });
        const workOrders = store.list('workOrders', { siteId });
        const report = store.insert('reports', {
            siteId, generatedAt: new Date().toISOString(), period: req.query.period || 'daily',
            summary: {
                facilities: facilities.length, operating: facilities.filter((f) => f.status === 'operating').length,
                pvArrays: arrays.length, pvCapacityKwp: Math.round(arrays.reduce((s, a) => s + a.capacityKwp, 0)),
                pvCritical: arrays.filter((a) => a.health?.status === 'critical').length, pvWarning: arrays.filter((a) => a.health?.status === 'warning').length,
                hotspots: hotspots.length, hotspotsCritical: hotspots.filter((h) => h.severity === 'critical').length,
                openAlerts: alerts.filter((a) => !a.acknowledged).length, missionsCompleted: missions.filter((m) => m.status === 'completed').length, datasets: datasets.length,
            },
            topHotspots: hotspots.sort((a, b) => b.maxT - a.maxT).slice(0, 10),
            arrayHealth: arrays.map((a) => ({ id: a.id, name: a.name, capacityKwp: a.capacityKwp, status: a.health?.status, hotspots: a.health?.hotspotCount || 0, lastThermalInspection: a.lastThermalInspection, lastCleaning: a.lastCleaning })),
            alerts: alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
            inspections: inspections.slice(0, 5),
            missions, workOrders,
            recommendations: buildRecommendations({ arrays, hotspots, alerts, facilities }),
        });
        res.json(report);
    });

    r.get('/reports', (req, res) => {
        const filter = req.query.siteId ? { siteId: String(req.query.siteId) } : null;
        res.json(store.list('reports', filter).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 30));
    });

    return r;
}

function buildRecommendations({ arrays, hotspots, alerts, facilities }) {
    const out = [];
    const critical = arrays.filter((a) => a.health?.status === 'critical');
    if (critical.length) out.push({ priority: 'high', text: `심각 등급 PV 어레이 ${critical.length}개소: 바이패스 다이오드·접속함 점검 및 해당 스트링 절연저항 측정 권고 (${critical.map((a) => a.name).join(', ')})` });
    const warn = arrays.filter((a) => a.health?.status === 'warning');
    if (warn.length) out.push({ priority: 'medium', text: `주의 등급 어레이 ${warn.length}개소: 모듈 표면 오염·그늘 여부 확인 후 세척 일정 반영` });
    const nonPv = hotspots.filter((h) => !h.arrayId && h.severity !== 'low');
    if (nonPv.length) out.push({ priority: 'medium', text: `PV 외 고온원 ${nonPv.length}건 탐지: 공정 배기·보일러·전기설비 과열 여부 현장 확인` });
    const stale = arrays.filter((a) => !a.lastCleaning || Date.now() - new Date(a.lastCleaning).getTime() > 90 * 86400000);
    if (stale.length) out.push({ priority: 'low', text: `세척 90일 경과 어레이 ${stale.length}개소: 발전효율 저하 예방을 위한 세척 권고` });
    const openAlerts = alerts.filter((a) => !a.acknowledged);
    if (openAlerts.length) out.push({ priority: 'medium', text: `미확인 알림 ${openAlerts.length}건 처리 필요` });
    const risky = facilities.filter((f) => (f.riskScore || 0) >= 60);
    if (risky.length) out.push({ priority: 'medium', text: `위험도 60 이상 시설 ${risky.length}개소: 유해화학물질 취급·분진 관리 상태 점검` });
    if (!out.length) out.push({ priority: 'low', text: '특이사항 없음. 정기 순찰 및 열화상 점검 주기를 유지하세요.' });
    return out;
}
