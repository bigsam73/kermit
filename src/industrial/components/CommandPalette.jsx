// Ctrl+K 커맨드 팔레트: 메뉴 · 단지 · 상호/필지 · 시설 · 핫스팟 · 화면 동작을 한 곳에서 검색
import React, { useEffect, useMemo, useRef, useState } from 'react';
import useIndustrialStore from '../store';
import useUiStore from '../uiStore';
import { MENUS, SEVERITY_LABELS } from '../constants';
import { MenuIcon, Icon } from '../icons';

export default function CommandPalette() {
    const open = useUiStore((s) => s.paletteOpen);
    const close = useUiStore((s) => s.closePalette);
    const openPalette = useUiStore((s) => s.openPalette);
    const [q, setQ] = useState('');
    const [idx, setIdx] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const sites = useIndustrialStore((s) => s.sites);
    const parcels = useIndustrialStore((s) => s.parcels);
    const facilities = useIndustrialStore((s) => s.facilities);
    const hotspots = useIndustrialStore((s) => s.hotspots);

    // Ctrl/⌘+K 로 열기 (입력창 안에서도 동작)
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (useUiStore.getState().paletteOpen) useUiStore.getState().closePalette();
                else openPalette();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [openPalette]);

    useEffect(() => {
        if (open) {
            setQ('');
            setIdx(0);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);

    const all = useMemo(() => {
        const I = useIndustrialStore.getState;
        const U = useUiStore.getState;
        const list = [];
        MENUS.forEach((m) => list.push({ ic: <MenuIcon id={m.id} size={16} />, label: m.label, sub: m.desc, kind: '메뉴', run: () => I().setMenu(m.id) }));
        list.push(
            { ic: <Icon name="contrast" />, label: '테마 전환 (다크 → 라이트 → 고대비)', kind: '동작', run: () => U().cycleTheme() },
            { ic: <Icon name="palette" />, label: '화면 스타일 메뉴 열기', sub: '테마 · 강조색 · 밀도 · 메뉴 형태', kind: '동작', run: () => U().toggleStyleMenu() },
            { ic: <Icon name="wall" />, label: '관제 월 모드 시작', sub: '전체화면 · 큰 글씨 · 위험 지점 자동 순회', kind: '동작', run: () => U().setWall(true) },
            { ic: <Icon name="bell" />, label: '알림 센터 열기/닫기', kind: '동작', run: () => U().toggleAlertCenter() },
        );
        sites.forEach((s) => list.push({ ic: <Icon name="site" />, label: s.name, sub: s.region, kind: '단지', run: () => I().setActiveSite(s.id) }));
        facilities.forEach((f) => list.push({
            ic: <Icon name="facility" />, label: f.name || f.id, sub: f.category || '', kind: '시설',
            run: () => { I().setSelected({ type: 'facility', id: f.id }); if (f.lon != null) I().flyTo({ lon: f.lon, lat: f.lat, height: 320, pitch: -55 }); },
        }));
        parcels.filter((p) => p.company).forEach((p) => list.push({
            ic: <Icon name="parcel" />, label: p.company, sub: p.address || '', kind: '상호',
            run: () => { I().setMenu('lots'); I().setSelected({ type: 'parcel', id: p.id }); if (p.lon != null) I().flyTo({ lon: p.lon, lat: p.lat, height: 260, pitch: -75 }); },
        }));
        hotspots.filter((h) => h.status !== 'resolved').forEach((h) => list.push({
            ic: <Icon name="hotspot" />, label: `핫스팟 #${h.index ?? ''} +${h.deltaT}°C`, sub: `${SEVERITY_LABELS[h.severity] || ''} · ${h.arrayName || 'PV 외'}`, kind: '핫스팟',
            run: () => { I().setMenu('thermal'); I().setHighlightHotspot(h.id); if (h.lon != null) I().flyTo({ lon: h.lon, lat: h.lat, height: 140, pitch: -70 }); },
        }));
        return list;
    }, [sites, parcels, facilities, hotspots, open]); // eslint-disable-line react-hooks/exhaustive-deps

    const results = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return all.filter((r) => r.kind === '메뉴' || r.kind === '동작').slice(0, 16);
        return all.filter((r) => `${r.label} ${r.sub || ''} ${r.kind}`.toLowerCase().includes(t)).slice(0, 40);
    }, [all, q]);

    useEffect(() => { setIdx(0); }, [q]);
    useEffect(() => { listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }); }, [idx]);

    if (!open) return null;
    const run = (r) => { close(); r?.run(); };
    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
        else if (e.key === 'Enter') run(results[idx]);
        else if (e.key === 'Escape') close();
    };

    return (
        <div className="gi-palette-ov pointer-events-auto" onMouseDown={(e) => e.target === e.currentTarget && close()}>
            <div className="gi-palette" role="dialog" aria-label="빠른 검색">
                <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="메뉴 · 단지 · 상호 · 시설 · 핫스팟 검색…" aria-label="검색어" />
                <ul ref={listRef}>
                    {results.map((r, i) => (
                        <li key={`${r.kind}-${i}-${r.label}`} className={i === idx ? 'is-sel' : ''} onMouseMove={() => setIdx(i)} onClick={() => run(r)}>
                            <span className="ic">{r.ic}</span>
                            <span>{r.label}{r.sub ? <span className="sub">{r.sub}</span> : null}</span>
                            <span className="k">{r.kind}</span>
                        </li>
                    ))}
                    {!results.length && <li style={{ cursor: 'default', color: 'var(--gi-dim)' }}>결과가 없습니다</li>}
                </ul>
                <footer><span>↑↓ 이동</span><span>Enter 선택</span><span>Esc 닫기</span><span style={{ marginLeft: 'auto' }}>{results.length}건</span></footer>
            </div>
        </div>
    );
}
