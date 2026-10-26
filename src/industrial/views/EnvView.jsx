// 환경 모니터링: 기상 · 대기질 · 단지 센서 실시간
import React from 'react';
import useIndustrialStore from '../store';
import useStore from '../../store/useStore';
import { Section, Stat, Badge, Button, Sparkline, Toggle, fmt, fmtTime } from '../components/ui';

function aqiTone(v) {
    if (v == null) return 'default';
    if (v <= 50) return 'ok';
    if (v <= 100) return 'default';
    if (v <= 150) return 'warn';
    return 'bad';
}
function aqiLabel(v) {
    if (v == null) return '-';
    if (v <= 50) return '좋음';
    if (v <= 100) return '보통';
    if (v <= 150) return '민감군 주의';
    if (v <= 200) return '나쁨';
    return '매우 나쁨';
}

export default function EnvView() {
    const weather = useIndustrialStore((s) => s.weather);
    const airQuality = useIndustrialStore((s) => s.airQuality);
    const telemetry = useIndustrialStore((s) => s.telemetry);
    const sensors = useIndustrialStore((s) => s.sensors);
    const refreshEnvironment = useIndustrialStore((s) => s.refreshEnvironment);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const layers = useStore((s) => s.layers);
    const toggleLayer = useStore((s) => s.toggleLayer);
    const cur = weather?.current;
    const aq = airQuality?.current;
    const liveSensors = telemetry?.sensors || [];

    return (
        <>
            <Section title="현재 기상 (Open-Meteo)" right={<Button size="xs" onClick={() => refreshEnvironment()}>갱신</Button>}>
                {weather?.error && <div className="gi-error">{weather.error}</div>}
                {cur && (
                    <>
                        <div className="gi-row">
                            <Badge color="#38bdf8">{weather.description}</Badge>
                            <Badge color={weather.droneFlightOk ? '#22c55e' : '#ef4444'} dot>{weather.droneFlightOk ? '드론 비행 가능' : '드론 비행 제한'}</Badge>
                            <span className="gi-muted">{fmtTime(cur.time)}</span>
                        </div>
                        <div className="gi-grid-4">
                            <Stat label="기온" value={fmt(cur.temperature_2m, 1)} unit="°C" />
                            <Stat label="습도" value={fmt(cur.relative_humidity_2m)} unit="%" />
                            <Stat label="풍속/돌풍" value={`${fmt(cur.wind_speed_10m, 1)}/${fmt(cur.wind_gusts_10m, 1)}`} unit="m/s" tone={cur.wind_gusts_10m >= 12 ? 'warn' : 'default'} />
                            <Stat label="풍향" value={fmt(cur.wind_direction_10m)} unit="°" />
                            <Stat label="일사량" value={fmt(cur.shortwave_radiation)} unit="W/㎡" tone="accent" />
                            <Stat label="구름" value={fmt(cur.cloud_cover)} unit="%" />
                            <Stat label="강수" value={fmt(cur.precipitation, 1)} unit="mm" />
                            <Stat label="일출/일몰" value={`${(weather.daily?.sunrise?.[0] || '').slice(11, 16)}~${(weather.daily?.sunset?.[0] || '').slice(11, 16)}`} />
                        </div>
                        {weather.hourly?.shortwave_radiation && (
                            <>
                                <div className="gi-muted">향후 48시간 일사량 (W/㎡)</div>
                                <Sparkline data={weather.hourly.shortwave_radiation.slice(0, 48)} width={370} height={44} color="#fbbf24" />
                                <div className="gi-muted">향후 48시간 풍속 (m/s) · 비행 한계 12 m/s</div>
                                <Sparkline data={weather.hourly.wind_speed_10m.slice(0, 48)} width={370} height={40} color="#38bdf8" min={0} max={Math.max(14, ...weather.hourly.wind_speed_10m.slice(0, 48))} />
                            </>
                        )}
                    </>
                )}
            </Section>

            <Section title="대기질 (Open-Meteo CAMS)">
                {airQuality?.error && <div className="gi-error">{airQuality.error}</div>}
                {aq && (
                    <div className="gi-grid-4">
                        <Stat label="US AQI" value={fmt(aq.us_aqi)} tone={aqiTone(aq.us_aqi)} sub={aqiLabel(aq.us_aqi)} />
                        <Stat label="PM10" value={fmt(aq.pm10, 1)} unit="㎍/㎥" tone={aq.pm10 > 80 ? 'warn' : 'default'} />
                        <Stat label="PM2.5" value={fmt(aq.pm2_5, 1)} unit="㎍/㎥" tone={aq.pm2_5 > 35 ? 'warn' : 'default'} />
                        <Stat label="O₃" value={fmt(aq.ozone, 1)} unit="㎍/㎥" />
                        <Stat label="NO₂" value={fmt(aq.nitrogen_dioxide, 1)} unit="㎍/㎥" />
                        <Stat label="SO₂" value={fmt(aq.sulphur_dioxide, 1)} unit="㎍/㎥" />
                        <Stat label="CO" value={fmt(aq.carbon_monoxide)} unit="㎍/㎥" />
                        <Stat label="EU AQI" value={fmt(aq.european_aqi)} />
                    </div>
                )}
            </Section>

            <Section title={`단지 센서 (${sensors.length})`} right={<span>{telemetry ? `갱신 ${fmtTime(telemetry.at)}` : '수신 대기'}</span>}>
                <div className="gi-list">
                    {sensors.map((s) => {
                        const live = liveSensors.find((x) => x.sensorId === s.id);
                        const r = live?.reading || {};
                        return (
                            <div key={s.id} className="gi-list-item is-clickable" onClick={() => { setSelected({ type: 'sensor', id: s.id }); flyTo({ lon: s.lon, lat: s.lat, height: 260, pitch: -60 }); }}>
                                <Badge color={live?.status === 'warning' ? '#f59e0b' : '#22c55e'} dot>{live?.status === 'warning' ? '주의' : '정상'}</Badge>
                                <div className="min-w-0 flex-1">
                                    <div className="gi-list-title">{s.name}</div>
                                    <div className="gi-list-sub">
                                        {s.type === 'air' && `PM10 ${r.pm10 ?? '-'} · PM2.5 ${r.pm25 ?? '-'} · NO₂ ${r.no2 ?? '-'} ppb`}
                                        {s.type === 'noise' && `소음 ${r.noiseDb ?? '-'} dB (주간 기준 70 dB)`}
                                        {s.type === 'voc' && `VOC ${r.voc ?? '-'} ppm · 악취 ${r.voc > 0.3 ? '감지' : '정상'}`}
                                        {s.type === 'weather' && `기온 ${r.tempC ?? '-'} °C · 습도 ${r.humidity ?? '-'} %`}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="gi-muted">센서 값은 실제 IoT 게이트웨이(MQTT/Modbus) 연동 전까지 시뮬레이션 데이터입니다.</div>
            </Section>

            <Section title="광역 환경 레이어">
                <Toggle label="기상 (전지구 샘플링)" checked={Boolean(layers.weather?.enabled)} onChange={() => toggleLayer('weather')} />
                <Toggle label="대기질 (주요 도시)" checked={Boolean(layers.airQuality?.enabled)} onChange={() => toggleLayer('airQuality')} />
                <Toggle label="기상특보 (NOAA/NWS)" checked={Boolean(layers.weatherAlerts?.enabled)} onChange={() => toggleLayer('weatherAlerts')} />
                <Toggle label="산불 열점 (NASA FIRMS 24h)" checked={Boolean(layers.fireHotspots?.enabled)} onChange={() => toggleLayer('fireHotspots')} />
            </Section>
        </>
    );
}
