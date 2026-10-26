import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store/useStore';

const BOOT_SEQUENCE = [
    { delay: 200, msg: '> PICT INDUSTRIAL — 산업단지 관제 시스템 기동' },
    { delay: 400, msg: '> API 서버 연결 (port 3200)...' },
    { delay: 600, msg: '> 실시간 텔레메트리(SSE) 구독 시작' },
    { delay: 800, msg: '> 위성 배경영상 · 지형 초기화' },
    { delay: 1000, msg: '> 단지 데이터(시설·PV·센서·데이터셋) 로드' },
];

const LAYER_MESSAGES = {
    sites: { loading: '> 산업단지 경계 로드...', active: count => `> 산업단지 ${count}개소 표시` },
    facilities: { loading: '> 시설·필지 로드...', active: count => `> 시설 ${count.toLocaleString()}동 3D 블록 생성` },
    solarPanels: { loading: '> PV 어레이 로드...', active: count => `> 태양광 어레이 ${count}개 · 인버터 텔레메트리 연결` },
    thermalHotspots: { loading: '> 열화상 분석 결과 로드...', active: count => `> 열 이상 핫스팟 ${count}건 표시` },
    imagery: { loading: '> 정사영상/열화상 오버레이 로드...', active: count => `> 영상 오버레이 ${count}개 활성` },
    tiles3d: { loading: '> 실측 3D Tiles 스트리밍...', active: count => `> 3D Tiles ${count}개 세트 로드` },
    droneOps: { loading: '> 드론 스테이션 연결...', active: count => `> 드론 자산/사진 ${count.toLocaleString()}건` },
    sensors: { loading: '> 단지 센서망 연결...', active: count => `> 환경 센서 ${count}개 수신 중` },
    aircraft: { loading: '> INTERCEPTING ADS-B transponder signals...', active: count => `> ${count.toLocaleString()} aircraft targets LOCKED` },
    satellites: { loading: '> Acquiring orbital telemetry data...', active: count => `> ${count.toLocaleString()} satellites TRACKED — orbital grid ONLINE` },
    seismic: { loading: '> Tapping into seismograph network...', active: count => `> ${count.toLocaleString()} seismic events DETECTED` },
    airports: { loading: '> Mapping global airfield database...', active: count => `> ${count.toLocaleString()} airfields CATALOGUED` },
    seismicStations: { loading: '> Connecting to monitoring stations...', active: count => `> ${count.toLocaleString()} seismic stations ONLINE` },
    maritime: { loading: '> Scanning maritime AIS transponders...', active: count => `> ${count.toLocaleString()} vessels on SONAR` },
    powerGrid: { loading: '> Infiltrating power grid telemetry...', active: count => `> ${count.toLocaleString()} power nodes MAPPED` },
    cctv: { loading: '> DECRYPTING CCTV feed matrix...', active: count => `> ${count.toLocaleString()} surveillance cameras ONLINE` },
    traffic: { loading: '> Hijacking traffic sensor network...', active: count => `> ${count.toLocaleString()} traffic feeds CAPTURED` },
    conflicts: { loading: '> Scanning conflict zone intelligence...', active: count => `> ${count.toLocaleString()} conflict areas FLAGGED` },
    militaryActivity: { loading: '> Monitoring military comm channels...', active: count => `> ${count.toLocaleString()} military movements DETECTED` },
    militaryBases: { loading: '> Cross-referencing classified installations...', active: count => `> ${count.toLocaleString()} military sites IDENTIFIED` },
};

export default function SysTerminal() {
    const layers = useStore((s) => s.layers);
    const sysTerminalVisible = useStore((s) => s.sysTerminalVisible);
    const toggleSysTerminal = useStore((s) => s.toggleSysTerminal);
    const [lines, setLines] = useState([]);
    const scrollRef = useRef(null);
    const seenRef = useRef(new Set());

    // Boot sequence
    useEffect(() => {
        BOOT_SEQUENCE.forEach(({ delay, msg }) => {
            setTimeout(() => {
                setLines((prev) => [...prev.slice(-40), msg]);
            }, delay);
        });
    }, []);

    // Monitor layer status changes
    useEffect(() => {
        Object.entries(layers).forEach(([key, layer]) => {
            const msgs = LAYER_MESSAGES[key];
            if (!msgs) return;

            const loadKey = `${key}:loading`;
            const activeKey = `${key}:active:${layer.count}`;

            if (layer.status === 'loading' && !seenRef.current.has(loadKey)) {
                seenRef.current.add(loadKey);
                setLines((prev) => [...prev.slice(-40), msgs.loading]);
            }

            if (layer.status === 'active' && layer.count > 0 && !seenRef.current.has(activeKey)) {
                seenRef.current.add(activeKey);
                seenRef.current.forEach((k) => {
                    if (k.startsWith(`${key}:active:`) && k !== activeKey) {
                        seenRef.current.delete(k);
                    }
                });
                setLines((prev) => [...prev.slice(-40), msgs.active(layer.count)]);
            }
        });
    }, [layers]);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [lines]);

    // Position directly below the LayerPanel — same left, same width
    const leftPos = 'max(16px, env(safe-area-inset-left))';
    const panelWidth = '16rem';

    // When hidden, show a small reopen button pinned to bottom-left
    if (!sysTerminalVisible) {
        return (
            <button
                onClick={toggleSysTerminal}
                className="pointer-events-auto sys-terminal-toggle"
                style={{ position: 'absolute', bottom: '24px', left: leftPos }}
                title="Show terminal"
            >
                ▸ SYS
            </button>
        );
    }

    return (
        <div
            className="sys-terminal pointer-events-auto"
            style={{ position: 'absolute', bottom: '24px', left: leftPos, width: panelWidth }}
        >
            <div className="sys-terminal-header">
                <span className="sys-terminal-dot"></span>
                <span style={{ flex: 1 }}>SYS://산업단지 관제 로그</span>
                <button
                    onClick={toggleSysTerminal}
                    className="pointer-events-auto"
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'rgba(56, 189, 248, 0.4)', fontSize: '10px', lineHeight: 1,
                        padding: '0 2px',
                    }}
                    title="Hide terminal"
                >✕</button>
            </div>
            <div className="sys-terminal-body" ref={scrollRef}>
                {lines.map((line, i) => (
                    <div key={i} className={`sys-terminal-line ${i === lines.length - 1 ? 'sys-terminal-line--latest' : ''}`}>
                        {line}
                    </div>
                ))}
                <span className="sys-terminal-cursor">█</span>
            </div>
        </div>
    );
}
