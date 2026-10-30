// 관제 월 모드: 전체화면 + 위험 지점 자동 순회. Esc 또는 전체화면 해제 시 종료
import React, { useEffect, useRef, useState } from 'react';
import useIndustrialStore from '../store';
import useUiStore from '../uiStore';
import { Icon } from '../icons';

const INTERVAL_MS = 20000;

export default function WallRunner() {
    const wall = useUiStore((s) => s.wall);
    const setWall = useUiStore((s) => s.setWall);
    const [paused, setPaused] = useState(false);
    const [label, setLabel] = useState('');
    const step = useRef(0);

    useEffect(() => {
        if (!wall) return undefined;
        const onKey = (e) => e.key === 'Escape' && !useUiStore.getState().paletteOpen && setWall(false);
        const onFs = () => { if (!document.fullscreenElement && useUiStore.getState().wall && step.current > 0) setWall(false); };
        window.addEventListener('keydown', onKey);
        document.addEventListener('fullscreenchange', onFs);
        return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
    }, [wall, setWall]);

    useEffect(() => {
        if (!wall || paused) return undefined;
        const visit = () => {
            const st = useIndustrialStore.getState();
            const targets = [
                ...st.hotspots.filter((h) => h.severity === 'critical' && h.status !== 'resolved' && h.lon != null).map((h) => ({ label: `핫스팟 +${h.deltaT}°C · ${h.arrayName || 'PV 외'}`, lon: h.lon, lat: h.lat, height: 160 })),
                ...st.alerts.filter((a) => !a.acknowledged && a.level === 'critical' && a.lon != null).map((a) => ({ label: `알림 · ${a.title}`, lon: a.lon, lat: a.lat, height: 240 })),
            ];
            const site = st.sites.find((s) => s.id === st.activeSiteId);
            if (!targets.length && site) targets.push({ label: `${site.name} 전경`, lon: site.lon, lat: site.lat, height: site.cameraHeight || 2500 });
            if (!targets.length) return;
            const t = targets[step.current % targets.length];
            step.current += 1;
            setLabel(t.label);
            st.flyTo({ lon: t.lon, lat: t.lat, height: t.height, pitch: -55, heading: 0 });
        };
        visit();
        const id = setInterval(visit, INTERVAL_MS);
        return () => clearInterval(id);
    }, [wall, paused]);

    useEffect(() => { if (!wall) step.current = 0; }, [wall]);

    if (!wall) return null;
    return (
        <div className="gi-wallbar gi-floating glass-panel pointer-events-auto">
            <span className="gi-title-icon"><Icon name="wall" size={15} /> <b>관제 월 모드</b></span>
            {label && <span>현재 대상: <b>{label}</b></span>}
            <button className="gi-btn gi-btn--sm" onClick={() => setPaused((p) => !p)}>{paused ? '▶ 순회 재개' : '❚❚ 일시정지'}</button>
            <button className="gi-btn gi-btn--sm gi-btn--danger" onClick={() => setWall(false)}>종료 (Esc)</button>
        </div>
    );
}
