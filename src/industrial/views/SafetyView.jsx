// 안전·재난: 알림 센터 · 위험 시설 · 광역 위험요소 레이어 · 알림 생성
import React, { useState } from 'react';
import useIndustrialStore from '../store';
import useStore from '../../store/useStore';
import { api } from '../api';
import { Section, Stat, Badge, Button, Toggle, Field, Input, Select, fmt, ago } from '../components/ui';
import { ALERT_LEVEL_COLORS, ALERT_LEVEL_LABELS } from '../constants';

const CATEGORY_LABELS = { solar: '태양광', environment: '환경', safety: '안전', drone: '드론', security: '보안', fire: '화재', weather: '기상', facility: '시설' };

export default function SafetyView() {
    const alerts = useIndustrialStore((s) => s.alerts);
    const facilities = useIndustrialStore((s) => s.facilities);
    const ackAlert = useIndustrialStore((s) => s.ackAlert);
    const flyTo = useIndustrialStore((s) => s.flyTo);
    const setSelected = useIndustrialStore((s) => s.setSelected);
    const refreshCollection = useIndustrialStore((s) => s.refreshCollection);
    const activeSiteId = useIndustrialStore((s) => s.activeSiteId);
    const layers = useStore((s) => s.layers);
    const toggleLayer = useStore((s) => s.toggleLayer);
    const [tab, setTab] = useState('open');
    const [form, setForm] = useState({ level: 'warning', category: 'safety', title: '', message: '' });

    const list = alerts.filter((a) => (tab === 'open' ? !a.acknowledged : tab === 'all' ? true : a.acknowledged)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const risky = facilities.filter((f) => (f.riskScore || 0) >= 50).sort((a, b) => b.riskScore - a.riskScore);

    const create = async () => {
        if (!form.title) return;
        await api.post('/api/alerts', { ...form, siteId: activeSiteId, acknowledged: false, source: 'operator' });
        setForm({ level: 'warning', category: 'safety', title: '', message: '' });
        refreshCollection('alerts');
    };

    return (
        <>
            <div className="gi-grid-3">
                <Stat label="미확인" value={alerts.filter((a) => !a.acknowledged).length} tone="warn" />
                <Stat label="심각" value={alerts.filter((a) => !a.acknowledged && a.level === 'critical').length} tone="bad" />
                <Stat label="고위험 시설" value={risky.length} />
            </div>

            <Section title="알림 센터" right={
                <div className="gi-row">
                    {[['open', '미확인'], ['done', '확인됨'], ['all', '전체']].map(([k, l]) => <Button key={k} size="xs" tone={tab === k ? 'primary' : 'ghost'} onClick={() => setTab(k)}>{l}</Button>)}
                </div>
            }>
                <div className="gi-timeline">
                    {list.map((a) => (
                        <div key={a.id} className="gi-tl-item" style={{ opacity: a.acknowledged ? 0.65 : 1, '--c': ALERT_LEVEL_COLORS[a.level] || '#94a3b8' }}>
                            <div className="min-w-0 flex-1">
                                <div className="gi-tl-time">{ALERT_LEVEL_LABELS[a.level]} · {ago(a.createdAt)}</div>
                                <div className="gi-tl-title">{a.title}</div>
                                <div className="gi-tl-msg">{a.message}</div>
                                <div className="gi-row" style={{ marginTop: 4 }}>
                                    <Badge color="#94a3b8" size="xs">{CATEGORY_LABELS[a.category] || a.category}</Badge>
                                    <span className="gi-muted">{ago(a.createdAt)} · {a.source}</span>
                                    {a.lon && <Button size="xs" onClick={() => flyTo({ lon: a.lon, lat: a.lat, height: 240, pitch: -60 })}>위치</Button>}
                                    {a.refType === 'panelArray' && <Button size="xs" onClick={() => setSelected({ type: 'panelArray', id: a.refId })}>대상</Button>}
                                    {!a.acknowledged && <Button size="xs" tone="success" onClick={() => ackAlert(a.id)}>확인</Button>}
                                </div>
                            </div>
                        </div>
                    ))}
                    {!list.length && <div className="gi-empty">알림이 없습니다</div>}
                </div>
            </Section>

            <Section title="위험 시설 (위험도 50 이상)">
                <div className="gi-list">
                    {risky.slice(0, 8).map((f) => (
                        <div key={f.id} className="gi-list-item is-clickable" onClick={() => { setSelected({ type: 'facility', id: f.id }); flyTo({ lon: f.lon, lat: f.lat, height: 320, pitch: -55 }); }}>
                            <Badge color={f.riskScore >= 70 ? '#ef4444' : '#f59e0b'}>{f.riskScore}</Badge>
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{f.name}</div>
                                <div className="gi-list-sub">{f.hazard} · 상시 {fmt(f.employees)}명 · 최근 점검 {f.lastInspection}</div>
                            </div>
                        </div>
                    ))}
                    {!risky.length && <div className="gi-empty">고위험 시설 없음</div>}
                </div>
            </Section>

            <Section title="광역 위험요소 레이어 (godseye 피드)">
                <Toggle label="산불 열점 (NASA FIRMS)" checked={Boolean(layers.fireHotspots?.enabled)} onChange={() => toggleLayer('fireHotspots')} />
                <Toggle label="지진 (USGS/IRIS)" checked={Boolean(layers.seismic?.enabled)} onChange={() => toggleLayer('seismic')} />
                <Toggle label="재난 경보 (GDACS)" checked={Boolean(layers.disasters?.enabled)} onChange={() => toggleLayer('disasters')} />
                <Toggle label="자연재해 이벤트 (NASA EONET)" checked={Boolean(layers.hazards?.enabled)} onChange={() => toggleLayer('hazards')} />
                <Toggle label="항공기 (ADS-B) · 드론 공역 확인" checked={Boolean(layers.aircraft?.enabled)} onChange={() => toggleLayer('aircraft')} />
                <Toggle label="비행제한공역" checked={Boolean(layers.airspace?.enabled)} onChange={() => toggleLayer('airspace')} />
            </Section>

            <Section title="수동 알림 등록">
                <div className="gi-grid-2">
                    <Field label="등급"><Select value={form.level} onChange={(v) => setForm({ ...form, level: v })} options={Object.entries(ALERT_LEVEL_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                    <Field label="분류"><Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                </div>
                <Field label="제목"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 3블록 화학물질 누출 신고" /></Field>
                <Field label="내용"><Input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
                <Button tone="primary" onClick={create} disabled={!form.title}>알림 발행</Button>
            </Section>
        </>
    );
}
