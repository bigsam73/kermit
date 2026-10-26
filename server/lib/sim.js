// 실시간 텔레메트리 시뮬레이터 + SSE 브로드캐스트
// 실제 인버터/센서/도크 연동 전까지 동일한 메시지 형식으로 화면을 구동한다.
import { instantPowerKw, moduleTemperature } from './pv.js';

const clients = new Set();

export function sseHandler(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
    });
}

export function broadcast(event, payload) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
        try {
            res.write(msg);
        } catch {
            clients.delete(res);
        }
    }
}

export function clientCount() {
    return clients.size;
}

function noise(scale = 1) {
    return (Math.random() - 0.5) * 2 * scale;
}

// 사이트별 최신 기상 스냅샷(라우터에서 갱신) - GHI/기온을 발전 추정에 사용
const weatherSnapshots = new Map();
export function setWeatherSnapshot(siteId, snap) {
    weatherSnapshots.set(siteId, snap);
}

export function startSimulator(store, intervalMs = 5000) {
    const history = new Map(); // key -> ring buffer of {t, v}
    const push = (key, value, cap = 360) => {
        if (!history.has(key)) history.set(key, []);
        const buf = history.get(key);
        buf.push({ t: Date.now(), v: value });
        if (buf.length > cap) buf.splice(0, buf.length - cap);
    };

    const tick = () => {
        const now = Date.now();
        const hour = new Date(now + 9 * 3600000).getUTCHours() + new Date(now).getUTCMinutes() / 60;
        const sites = store.list('sites');
        for (const site of sites) {
            const wx = weatherSnapshots.get(site.id);
            // 일사량: 기상 API 값이 있으면 사용, 없으면 일변화 모델
            const sunModel = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) * 820;
            const ghi = wx?.ghi ?? sunModel;
            const ambient = wx?.temperature ?? 18 + 7 * Math.sin(((hour - 8) / 24) * 2 * Math.PI);

            const arrays = store.list('panelArrays', { siteId: site.id });
            const inverters = arrays.map((a) => {
                const health = a.health?.healthFactor ?? 1;
                const kw = instantPowerKw({ capacityKwp: a.capacityKwp, ghi, ambientC: ambient, healthFactor: health }) * (1 + noise(0.03));
                const tMod = moduleTemperature(ambient, ghi) + noise(1.5) + (a.health?.status === 'critical' ? 6 : 0);
                const row = {
                    arrayId: a.id, name: a.name, facilityId: a.facilityId, capacityKwp: a.capacityKwp,
                    powerKw: Math.round(kw * 10) / 10,
                    moduleTempC: Math.round(tMod * 10) / 10,
                    dcVoltage: Math.round(600 + noise(25)),
                    efficiency: a.capacityKwp ? Math.round((kw / a.capacityKwp) * 1000) / 10 : 0,
                    status: a.health?.status || 'normal',
                    inverterState: kw > 0.5 ? 'RUN' : 'STANDBY',
                };
                push(`pv:${a.id}`, row.powerKw);
                return row;
            });
            const totalKw = inverters.reduce((s, r) => s + r.powerKw, 0);
            push(`pv:site:${site.id}`, totalKw);

            const sensors = store.list('sensors', { siteId: site.id }).map((s) => {
                const base = s.baseline || {};
                const reading = {
                    pm10: Math.max(2, (base.pm10 ?? 28) + noise(6)),
                    pm25: Math.max(1, (base.pm25 ?? 14) + noise(4)),
                    no2: Math.max(1, (base.no2 ?? 18) + noise(5)),
                    voc: Math.max(0.02, (base.voc ?? 0.18) + noise(0.05)),
                    noiseDb: Math.max(35, (base.noiseDb ?? 58) + noise(4) + (hour > 8 && hour < 18 ? 4 : -3)),
                    tempC: ambient + noise(0.8),
                    humidity: Math.min(98, Math.max(20, (wx?.humidity ?? 55) + noise(3))),
                };
                Object.keys(reading).forEach((k) => { reading[k] = Math.round(reading[k] * 100) / 100; });
                push(`sensor:${s.id}`, reading.pm10);
                return { sensorId: s.id, name: s.name, type: s.type, lon: s.lon, lat: s.lat, reading, status: reading.pm10 > 80 || reading.noiseDb > 75 ? 'warning' : 'normal' };
            });

            const docks = store.list('docks', { siteId: site.id }).map((d) => {
                const phase = Math.floor(now / 60000) % 12; // 12분 주기 상태 순환 (데모)
                let state = 'IDLE';
                if (d.simulate !== false) {
                    if (phase < 2) state = 'PREFLIGHT';
                    else if (phase < 6) state = 'IN_MISSION';
                    else if (phase < 8) state = 'RETURNING';
                    else if (phase < 11) state = 'CHARGING';
                }
                return {
                    dockId: d.id, name: d.name, lon: d.lon, lat: d.lat, state,
                    battery: Math.round(state === 'CHARGING' ? 60 + (phase - 8) * 13 : state === 'IN_MISSION' ? 95 - (phase - 2) * 9 : 100),
                    windMs: Math.round(Math.max(0, (wx?.wind ?? 3) + noise(1)) * 10) / 10,
                    internalTempC: Math.round((26 + noise(2)) * 10) / 10,
                    online: true,
                    model: d.model,
                };
            });

            broadcast('telemetry', {
                siteId: site.id, at: new Date(now).toISOString(),
                env: { ghi: Math.round(ghi), ambientC: Math.round(ambient * 10) / 10 },
                pv: { totalKw: Math.round(totalKw * 10) / 10, capacityKwp: arrays.reduce((s, a) => s + (a.capacityKwp || 0), 0), inverters },
                sensors, docks,
            });
        }
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    return {
        stop: () => clearInterval(timer),
        history: (key) => history.get(key) || [],
        tickNow: tick,
    };
}
