// 미확인 심각 알림 배너 (상단 중앙)
import React from 'react';
import useIndustrialStore from '../store';
import { Button } from './ui';

export default function AlertBanner() {
    const alerts = useIndustrialStore((s) => s.alerts);
    const ackAlert = useIndustrialStore((s) => s.ackAlert);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const setMenu = useIndustrialStore((s) => s.setMenu);
    const critical = alerts.filter((a) => !a.acknowledged && a.level === 'critical').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!critical.length) return null;
    const top = critical[0];
    return (
        <div className="gi-alert-banner pointer-events-auto">
            <span className="gi-alert-pulse" />
            <div className="min-w-0">
                <div className="gi-alert-title">⚠ 심각 알림 {critical.length}건 · {top.title}</div>
                <div className="gi-alert-msg">{top.message}</div>
            </div>
            <div className="flex gap-1 shrink-0">
                {top.lon && <Button size="xs" onClick={() => flyTo({ lon: top.lon, lat: top.lat, height: 260, pitch: -60 })}>위치</Button>}
                <Button size="xs" onClick={() => setMenu('safety')}>목록</Button>
                <Button size="xs" tone="danger" onClick={() => ackAlert(top.id)}>확인</Button>
            </div>
        </div>
    );
}
