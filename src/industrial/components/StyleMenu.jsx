// 화면 스타일 메뉴: 언제든 테마 · 강조색 · 밀도 · 메뉴 형태를 바꾼다 (브라우저에 저장)
import React, { useEffect } from 'react';
import { Icon } from '../icons';
import useUiStore, { THEMES, ACCENTS, DENSITIES, NAV_STYLES, PRESETS, MATERIALS, MOTIONS } from '../uiStore';

function Options({ items, value, onPick }) {
    return (
        <div className="gi-opt-row">
            {items.map((it) => (
                <button key={it.id} className={`gi-opt ${value === it.id ? 'is-on' : ''}`} onClick={() => onPick(it.id)} aria-pressed={value === it.id}>
                    {it.label}{it.desc ? <small>{it.desc}</small> : null}
                </button>
            ))}
        </div>
    );
}

export default function StyleMenu() {
    const open = useUiStore((s) => s.styleMenuOpen);
    const style = useUiStore((s) => s.style);
    const setStyle = useUiStore((s) => s.setStyle);
    const resetStyle = useUiStore((s) => s.resetStyle);
    const close = useUiStore((s) => s.closeStyleMenu);
    const setWall = useUiStore((s) => s.setWall);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => e.key === 'Escape' && close();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

    if (!open) return null;
    const presetOn = (p) => Object.entries(p.style).every(([k, v]) => style[k] === v);

    return (
        <div className="gi-stylemenu gi-floating glass-panel pointer-events-auto" role="dialog" aria-label="화면 스타일">
            <h3><span className="gi-title-icon"><Icon name="palette" size={15} /> 화면 스타일</span> <button className="gi-panel-close" onClick={close} aria-label="닫기">×</button></h3>
            <section>
                <h4>빠른 프리셋</h4>
                <div className="gi-opt-row">
                    {PRESETS.map((p) => (
                        <button key={p.id} className={`gi-opt ${presetOn(p) ? 'is-on' : ''}`} onClick={() => setStyle(p.style)} style={{ flexBasis: '46%' }}>
                            {p.label}<small>{p.desc}</small>
                        </button>
                    ))}
                </div>
            </section>
            <section>
                <h4>테마</h4>
                <Options items={THEMES} value={style.theme} onPick={(theme) => setStyle({ theme })} />
            </section>
            <section>
                <h4>강조색</h4>
                <div className="gi-opt-row" style={{ gap: 10 }}>
                    {ACCENTS.map((a) => (
                        <button key={a.id} className={`gi-swatch ${style.accent === a.id ? 'is-on' : ''}`} style={{ background: a.hex }} title={a.label} aria-label={a.label} aria-pressed={style.accent === a.id} onClick={() => setStyle({ accent: a.id })} />
                    ))}
                </div>
            </section>
            <section>
                <h4>메뉴 형태</h4>
                <Options items={NAV_STYLES} value={style.nav} onPick={(nav) => setStyle({ nav })} />
            </section>
            <section>
                <h4>패널 재질</h4>
                <Options items={MATERIALS} value={style.material} onPick={(material) => setStyle({ material })} />
            </section>
            <section>
                <h4>모션</h4>
                <Options items={MOTIONS} value={style.motion} onPick={(motion) => setStyle({ motion })} />
            </section>
            <section>
                <h4>정보 밀도</h4>
                <Options items={DENSITIES} value={style.density} onPick={(density) => setStyle({ density })} />
            </section>
            <section className="gi-row" style={{ justifyContent: 'space-between' }}>
                <button className="gi-btn gi-btn--md gi-btn--primary" onClick={() => setWall(true)} title="전체화면 · 큰 글씨 · 위험 지점 자동 순회 (Esc 종료)"><span className="gi-title-icon"><Icon name="wall" size={14} /> 관제 월 모드</span></button>
                <button className="gi-btn gi-btn--md gi-btn--ghost" onClick={resetStyle}>기본값으로</button>
            </section>
            <div className="gi-muted">설정은 이 브라우저에 자동 저장됩니다 · Ctrl+K 로 빠른 검색</div>
        </div>
    );
}
