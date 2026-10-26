// 외부 공개 API 프록시 (Open-Meteo 날씨/일사량, 대기질) - 10분 캐시
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

async function cachedFetch(key, url, ttl = TTL_MS) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.data;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        cache.set(key, { at: Date.now(), data });
        return data;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchWeather(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
        + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,shortwave_radiation,precipitation,cloud_cover'
        + '&hourly=temperature_2m,shortwave_radiation,direct_radiation,wind_speed_10m,precipitation_probability,cloud_cover'
        + '&daily=sunrise,sunset,shortwave_radiation_sum,temperature_2m_max,temperature_2m_min,precipitation_sum'
        + '&forecast_days=3&timezone=Asia%2FSeoul&wind_speed_unit=ms';
    return cachedFetch(`wx:${lat.toFixed(3)},${lon.toFixed(3)}`, url);
}

export async function fetchAirQuality(lat, lon) {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
        + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
        + '&current=pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide,us_aqi,european_aqi'
        + '&hourly=pm10,pm2_5,nitrogen_dioxide,ozone&forecast_days=2&timezone=Asia%2FSeoul';
    return cachedFetch(`aq:${lat.toFixed(3)},${lon.toFixed(3)}`, url);
}

export const WEATHER_CODES = {
    0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '착빙 안개',
    51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비', 61: '약한 비', 63: '비', 65: '강한 비',
    71: '약한 눈', 73: '눈', 75: '강한 눈', 80: '소나기', 81: '강한 소나기', 82: '폭우', 95: '뇌우', 96: '우박 뇌우', 99: '강한 우박 뇌우',
};

export function describeWeatherCode(code) {
    return WEATHER_CODES[code] || `코드 ${code}`;
}
