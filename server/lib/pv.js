// 태양광 발전 추정 및 어레이 건전성 계산
// P[kW] = 설비용량[kWp] x (GHI/1000) x PR x (1 - gamma x (Tmod - 25))
const DEFAULT_PR = 0.8;
const GAMMA = 0.004; // 결정질 실리콘 온도계수 (1/°C)
const NOCT = 45;

export function moduleTemperature(ambientC, ghi) {
    return ambientC + ((NOCT - 20) / 800) * (ghi || 0);
}

export function instantPowerKw({ capacityKwp, ghi, ambientC, pr = DEFAULT_PR, healthFactor = 1 }) {
    if (!capacityKwp || !ghi || ghi <= 0) return 0;
    const tMod = moduleTemperature(ambientC ?? 25, ghi);
    const tempFactor = Math.max(0.5, 1 - GAMMA * (tMod - 25));
    return capacityKwp * (ghi / 1000) * pr * tempFactor * healthFactor;
}

// 시간별 예보(hourly: {time[], shortwave_radiation[], temperature_2m[]})로 일간 발전량(kWh) 추정
export function dailyEnergyKwh(array, hourly, healthFactor = 1) {
    if (!hourly?.time?.length) return { todayKwh: 0, tomorrowKwh: 0, series: [] };
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let todayKwh = 0;
    let tomorrowKwh = 0;
    const series = [];
    for (let i = 0; i < hourly.time.length; i++) {
        const t = hourly.time[i];
        const ghi = hourly.shortwave_radiation?.[i] ?? 0;
        const temp = hourly.temperature_2m?.[i] ?? 20;
        const kw = instantPowerKw({ capacityKwp: array.capacityKwp, ghi, ambientC: temp, healthFactor });
        if (t.startsWith(today)) todayKwh += kw;
        else if (t.startsWith(tomorrow)) tomorrowKwh += kw;
        if (t.startsWith(today)) series.push({ time: t, kw: Math.round(kw * 10) / 10, ghi });
    }
    return { todayKwh: Math.round(todayKwh * 10) / 10, tomorrowKwh: Math.round(tomorrowKwh * 10) / 10, series };
}

// 핫스팟 결과로 어레이 건전성 산출
export function arrayHealthFromHotspots(array, hotspots) {
    const mine = hotspots.filter((h) => h.arrayId === array.id);
    const critical = mine.filter((h) => h.severity === 'critical').length;
    const high = mine.filter((h) => h.severity === 'high').length;
    const medium = mine.filter((h) => h.severity === 'medium').length;
    const modules = array.moduleCount || 1;
    const affected = Math.min(modules, mine.length);
    const lossRatio = Math.min(0.6, (critical * 3 + high * 2 + medium) / modules * 4);
    const healthFactor = Math.max(0.4, 1 - lossRatio);
    let status = 'normal';
    if (critical > 0 || lossRatio > 0.2) status = 'critical';
    else if (high > 0 || lossRatio > 0.08) status = 'warning';
    else if (medium > 0) status = 'watch';
    return { status, healthFactor: Math.round(healthFactor * 1000) / 1000, hotspotCount: mine.length, critical, high, medium, affectedModules: affected };
}
