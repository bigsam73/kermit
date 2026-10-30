// 알림 센터: 우측 드로어. 심각도 필터 · 클릭 시 지도 이동 · 확인 처리. 열림 상태에 맞춰 상세 카드 위치를 조정(data-gi-alerts)
import React, { useEffect, useState } from 'react';
import useIndustrialStore from '../store';
import useUiStore from '../uiStore';
import { ALERT_LEVEL_COLORS, ALERT_LEVEL_LABELS } from '../constants';
import { Button, ago } from './ui';
import { Icon } from '../icons';

const FILTERS = [['all', '전체'], ['critical', '심각'], ['warning', '주의'], ['info', '정보']];

export default function AlertCenter() {
    const open = useUiStore((s) => s.alertCenterOpen);
    const close = useUiStore((s) => s.closeAlertCenter);
    const alerts = useIndustrialStore((s) => s.alerts);
    const ackAlert = useIndustrialStore((s) => s.ackAlert);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const [filter, setFilter] = useState('all');
    const [showAcked, setShowAcked] = useState(false);

    useEffect(() => {
        document.documentElement.dataset.giAlerts = open ? '1' : '0';
        return () => { document.documentElement.dataset.giAlerts = '0'; };
    }, [open]);

    if (!open) return null;
    const open_ = alerts.filter((a) => !a.acknowledged).length;
    const rows = alerts
        .filter((a) => (showAcked || !a.acknowledged) && (filter === 'all' || a.level === filter))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return (
        <aside className="gi-alertcenter gi-floating glass-panel pointer-events-auto" aria-label="알림 센터">
            <div className="gi-ac-head">
                <b className="gi-title-icon"><Icon name="bell" size={14} /> 알림 센터</b>
                <span className="gi-badge gi-badge--xs" style={{ color: open_ ? '#ef4444' : '#22c55e', borderColor: 'currentColor' }}>미확인 {open_}</span>
                <span style={{ flex: 1 }} />
                <label className="gi-muted" style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={showAcked} onChange={(e) => setShowAcked(e.target.checked)} />확인 포함
                </label>
                <button className="gi-panel-close" onClick={close} aria-label="알림 센터 닫기">×</button>
            </div>
            <div className="gi-ac-chips">
                {FILTERS.map(([k, l]) => (
                    <button key={k} className={`gi-opt ${filter === k ? 'is-on' : ''}`} style={{ flex: '0 0 auto', padding: '3px 10px', borderRadius: 99 }} onClick={() => setFilter(k)}>{l}</button>
                ))}
            </div>
            <div className="gi-ac-list">
                {rows.map((a) => (
                    <div
                        key={a.id}
                        className={`gi-ac-item ${a.acknowledged ? 'is-acked' : ''}`}
                        onClick={() => a.lon && flyTo({ lon: a.lon, lat: a.lat, height: 240, pitch: -60 })}
                        title={a.lon ? '클릭하면 지도에서 위치로 이동' : a.message}
                    >
                        <i style={{ background: ALERT_LEVEL_COLORS[a.level] || '#94a3b8' }} />
                        <div style={{ minWidth: 0 }}>
                            <b>{a.title}</b>
                            <span>{ALERT_LEVEL_LABELS[a.level] || a.level} · {a.category || a.source || ''} · {ago(a.createdAt)}</span>
                        </div>
                        {!a.acknowledged && <Button size="xs" onClick={(e) => { e?.stopPropagation?.(); ackAlert(a.id); }}>확인</Button>}
                    </div>
                ))}
                {!rows.length && <div className="gi-empty">표시할 알림이 없습니다</div>}
            </div>
        </aside>
    );
}
