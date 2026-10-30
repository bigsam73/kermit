// 공통 UI 프리미티브 (관제 패널용)
import React, { useEffect, useRef, useState } from 'react';
import { Icon, autoIconName } from '../icons';

export function Section({ title, right, children, className = '', icon }) {
    return (
        <section className={`gi-section ${className}`}>
            {(title || right) && (
                <header className="gi-section-head">
                    <span className="gi-section-title">{icon ?? (autoIconName(title) ? <Icon name={autoIconName(title)} size={14} /> : null)}{title}</span>
                    {right && <span className="gi-section-right">{right}</span>}
                </header>
            )}
            {children}
        </section>
    );
}

// 기존 Stat 호출은 모두 StatCard 로 렌더링(키워드로 아이콘 자동 선택). 아이콘이 필요 없으면 icon={null}
export function Stat({ label, value, unit, tone = 'default', sub, onClick, icon, delta, spark }) {
    const name = icon === undefined ? autoIconName(label) : null;
    const node = icon !== undefined ? icon : name ? <Icon name={name} size={15} /> : null;
    return <StatCard icon={node} label={label} value={value} unit={unit} tone={tone} sub={sub} onClick={onClick} delta={delta} spark={spark} />;
}

// 숫자 카운트업(0.7s, ease-out-expo). 숫자로 읽히지 않는 값/모션 줄이기에서는 그대로 표시
export function AnimNumber({ value }) {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
    const plain = text.replace(/,/g, '');
    const numeric = /^-?\d+(\.\d+)?$/.test(plain);
    const target = numeric ? Number(plain) : 0;
    const decimals = numeric && plain.includes('.') ? plain.split('.')[1].length : 0;
    const [shown, setShown] = useState(target);
    const from = useRef(target);
    useEffect(() => {
        if (!numeric) return undefined;
        const reduced = document.documentElement.dataset.giMotion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduced || from.current === target) { from.current = target; setShown(target); return undefined; }
        const start = from.current, t0 = performance.now(), dur = 700;
        let raf;
        const ease = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
        const tick = (now) => {
            const k = Math.min(1, (now - t0) / dur);
            setShown(start + (target - start) * ease(k));
            if (k < 1) raf = requestAnimationFrame(tick); else from.current = target;
        };
        raf = requestAnimationFrame(tick);
        return () => { cancelAnimationFrame(raf); from.current = target; };
    }, [target, numeric]);
    if (!numeric) return <>{value}</>;
    return <>{shown.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

// Tabler 식 통계 카드: 아이콘 칩 + 값 + 증감 + 미니 스파크라인
const TONE_COLOR = { ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', accent: 'var(--gi-accent)', default: '#94a3b8' };
export function StatCard({ icon, label, value, unit, sub, tone = 'default', delta, spark, onClick }) {
    const color = TONE_COLOR[tone] || TONE_COLOR.default;
    const W = 100, H = 20;
    let line = null;
    if (spark && spark.length > 2) {
        const mn = Math.min(...spark), mx = Math.max(...spark), span = mx - mn || 1;
        line = spark.map((v, i) => `${((i / (spark.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - mn) / span) * (H - 4)).toFixed(1)}`).join(' ');
    }
    return (
        <div className={`gi-statcard ${onClick ? 'is-clickable' : ''}`} style={{ '--c': color }} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}>
            <div className="gi-statcard-top">
                {icon && <span className="gi-statcard-ic">{icon}</span>}
                <span className="gi-statcard-label">{label}</span>
            </div>
            <div className="gi-statcard-value">
                <AnimNumber value={value} />{unit && <small>{unit}</small>}
                {delta != null && Math.abs(delta) >= 0.05 && <span className={`gi-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}</span>}
            </div>
            {sub && <div className="gi-statcard-sub">{sub}</div>}
            {line && <svg className="gi-statcard-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>}
        </div>
    );
}

// Tabler 식 누적 막대(진행률 스택) + 범례
export function StackBar({ items, height = 10 }) {
    const total = items.reduce((a, i) => a + i.value, 0) || 1;
    return (
        <div>
            <div className="gi-stackbar" style={{ height }} role="img" aria-label={items.map((i) => `${i.label} ${i.value}`).join(', ')}>
                {items.filter((i) => i.value > 0).map((i) => <span key={i.label} style={{ width: `${(i.value / total) * 100}%`, background: i.color }} title={`${i.label} ${i.value}`} />)}
            </div>
            <div className="gi-stackbar-legend">
                {items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label} <b>{i.value}</b></span>)}
            </div>
        </div>
    );
}

// Grafana 식 임계값 막대 게이지: thresholds=[{at, color}] 오름차순, 값에 맞는 색 사용
export function ThresholdBar({ value, max = 100, thresholds, unit = '%', label }) {
    const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
    const color = [...thresholds].reverse().find((t) => pct >= t.at)?.color || thresholds[0].color;
    return (
        <div className="gi-thbar">
            <div className="gi-between"><span className="gi-muted">{label}</span><b style={{ color }}>{Math.round(pct)}{unit}</b></div>
            <div className="gi-thbar-track">
                <div className="gi-thbar-fill" style={{ width: `${pct}%`, background: color }} />
                {thresholds.slice(1).map((t) => <i key={t.at} className="gi-thbar-tick" style={{ left: `${t.at}%` }} />)}
            </div>
        </div>
    );
}

export function Badge({ color = '#94a3b8', children, dot = false, size = 'sm' }) {
    return (
        <span className={`gi-badge gi-badge--${size}`} style={{ color, borderColor: `${color}66`, background: `${color}1a` }}>
            {dot && <span className="gi-badge-dot" style={{ background: color }} />}
            {children}
        </span>
    );
}

export function Button({ children, onClick, tone = 'default', size = 'sm', disabled, title, type = 'button', style }) {
    return (
        <button type={type} className={`gi-btn gi-btn--${tone} gi-btn--${size}`} onClick={onClick} disabled={disabled} title={title} style={style}>
            {children}
        </button>
    );
}

export function Toggle({ checked, onChange, label }) {
    return (
        <label className="gi-toggle-row">
            {label && <span>{label}</span>}
            <span className={`toggle-switch ${checked ? 'active' : ''}`} onClick={() => onChange(!checked)} />
        </label>
    );
}

export function Field({ label, children, hint }) {
    return (
        <label className="gi-field">
            <span className="gi-field-label">{label}</span>
            {children}
            {hint && <span className="gi-field-hint">{hint}</span>}
        </label>
    );
}

export function Input(props) {
    return <input {...props} className={`gi-input ${props.className || ''}`} />;
}

export function Select({ options, value, onChange, ...rest }) {
    return (
        <select className="gi-input" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    );
}

export function Table({ columns, rows, onRowClick, rowKey = 'id', empty = '데이터 없음', activeKey }) {
    return (
        <div className="gi-table-wrap">
            <table className="gi-table">
                <thead>
                    <tr>{columns.map((c) => <th key={c.key} style={{ width: c.width, textAlign: c.align || 'left' }}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                    {!rows.length && <tr><td colSpan={columns.length} className="gi-table-empty">{empty}</td></tr>}
                    {rows.map((row) => (
                        <tr key={row[rowKey]} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`${onRowClick ? 'is-clickable' : ''} ${activeKey && row[rowKey] === activeKey ? 'is-active' : ''}`}>
                            {columns.map((c) => <td key={c.key} style={{ textAlign: c.align || 'left' }}>{c.render ? c.render(row) : row[c.key]}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function Bar({ value, max = 100, color = '#38bdf8', height = 6, label }) {
    const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    return (
        <div className="gi-bar" style={{ height }} title={label}>
            <div className="gi-bar-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
    );
}

export function Sparkline({ data = [], width = 220, height = 44, color = '#38bdf8', fill = true, min: forcedMin, max: forcedMax }) {
    if (!data.length) return <div className="gi-spark-empty" style={{ width, height }}>데이터 수집 중</div>;
    const vals = data.map((d) => (typeof d === 'number' ? d : d.v));
    const min = forcedMin ?? Math.min(...vals);
    const max = forcedMax ?? Math.max(...vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => [(i / Math.max(1, vals.length - 1)) * width, height - ((v - min) / span) * (height - 4) - 2]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    return (
        <svg width={width} height={height} className="gi-spark">
            {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={color} opacity="0.12" />}
            <path d={d} stroke={color} strokeWidth="1.5" fill="none" />
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.5" fill={color} />
        </svg>
    );
}

export function Gauge({ value, max, label, color = '#22c55e', size = 84 }) {
    const pct = max > 0 ? Math.min(1, value / max) : 0;
    const r = size / 2 - 7;
    const c = 2 * Math.PI * r;
    return (
        <div className="gi-gauge" style={{ width: size }}>
            <svg width={size} height={size}>
                <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="6" fill="none" />
                <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
                <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="600">{Math.round(pct * 100)}%</text>
            </svg>
            <div className="gi-gauge-label">{label}</div>
        </div>
    );
}

export function Empty({ children }) {
    return <div className="gi-empty">{children}</div>;
}

export function Spinner({ label = '처리 중' }) {
    return <span className="gi-spinner">◌ {label}</span>;
}

export function KV({ items }) {
    return (
        <dl className="gi-kv">
            {items.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
                <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

export function fmt(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtDate(iso) {
    if (!iso) return '-';
    return String(iso).slice(0, 10);
}

export function ago(iso) {
    if (!iso) return '-';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return '방금';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    return `${Math.floor(diff / 86400000)}일 전`;
}
