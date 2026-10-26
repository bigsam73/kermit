// 보고서: 종합 점검 보고서 생성 · 인쇄 · 이력
import React, { useEffect, useState } from 'react';
import useIndustrialStore from '../store';
import { api } from '../api';
import { Section, Badge, Button, fmt, fmtTime } from '../components/ui';
import { HEALTH_LABELS, SEVERITY_LABELS } from '../constants';

function reportHtml(r, site) {
    const row = (cells) => `<tr>${cells.map((c) => `<td>${c ?? '-'}</td>`).join('')}</tr>`;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${site.name} 종합 점검 보고서</title>
<style>body{font-family:'Malgun Gothic',sans-serif;padding:28px;color:#111;font-size:12px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;border-left:4px solid #0ea5e9;padding-left:8px;margin:18px 0 8px}table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}.kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi div{border:1px solid #ddd;padding:8px;border-radius:4px}.kpi b{font-size:18px;display:block}.muted{color:#666}ul{padding-left:18px}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">인쇄 / PDF 저장</button>
<h1>${site.name} 종합 점검 보고서</h1><div class="muted">${site.region} · 생성 ${new Date(r.generatedAt).toLocaleString('ko-KR')} · PICT INDUSTRIAL</div>
<h2>1. 요약</h2><div class="kpi">
<div>시설<b>${r.summary.facilities}</b>가동 ${r.summary.operating}</div><div>PV 설비<b>${fmt(r.summary.pvCapacityKwp)} kWp</b>${r.summary.pvArrays}개 어레이</div>
<div>열 이상 핫스팟<b>${r.summary.hotspots}</b>심각 ${r.summary.hotspotsCritical}</div><div>미확인 알림<b>${r.summary.openAlerts}</b>임무 완료 ${r.summary.missionsCompleted}</div></div>
<h2>2. 권고 조치</h2><ul>${r.recommendations.map((x) => `<li><b>[${x.priority === 'high' ? '긴급' : x.priority === 'medium' ? '보통' : '낮음'}]</b> ${x.text}</li>`).join('')}</ul>
<h2>3. 태양광 어레이 건전성</h2><table><tr><th>어레이</th><th>용량(kWp)</th><th>상태</th><th>핫스팟</th><th>최근 열화상</th><th>최근 세척</th></tr>${r.arrayHealth.map((a) => row([a.name, fmt(a.capacityKwp), HEALTH_LABELS[a.status] || '정상', a.hotspots, a.lastThermalInspection, a.lastCleaning])).join('')}</table>
<h2>4. 주요 핫스팟 (상위 10)</h2><table><tr><th>#</th><th>등급</th><th>최고 °C</th><th>ΔT</th><th>면적 ㎡</th><th>위치</th><th>좌표</th></tr>${r.topHotspots.map((h) => row([h.index, SEVERITY_LABELS[h.severity], h.maxT, `+${h.deltaT}`, h.areaSqm, h.arrayName || 'PV 외', `${h.lat.toFixed(5)}, ${h.lon.toFixed(5)}`])).join('')}</table>
<h2>5. 알림 이력</h2><table><tr><th>시각</th><th>등급</th><th>제목</th><th>내용</th><th>확인</th></tr>${r.alerts.map((a) => row([new Date(a.createdAt).toLocaleString('ko-KR'), a.level, a.title, a.message, a.acknowledged ? '예' : '아니오'])).join('')}</table>
<h2>6. 드론 임무</h2><table><tr><th>임무</th><th>유형</th><th>상태</th><th>시각</th><th>고도</th><th>사진</th></tr>${r.missions.map((m) => row([m.name, m.type, m.status, new Date(m.scheduledAt).toLocaleString('ko-KR'), `${m.altitudeM} m`, m.photos || '-'])).join('')}</table>
<h2>7. 작업지시</h2><table><tr><th>제목</th><th>우선순위</th><th>담당</th><th>기한</th><th>상태</th></tr>${r.workOrders.map((w) => row([w.title, w.priority, w.assignee, w.dueDate, w.status])).join('')}</table>
<p class="muted">본 보고서는 드론 열화상 정사영상 분석, 위성·기상 데이터, 단지 센서 텔레메트리를 바탕으로 자동 생성되었습니다.</p></body></html>`;
}

export default function ReportView() {
    const site = useIndustrialStore((s) => s.sites.find((x) => x.id === s.activeSiteId));
    const [reports, setReports] = useState([]);
    const [busy, setBusy] = useState(false);
    const [current, setCurrent] = useState(null);

    const load = async () => {
        if (!site) return;
        setReports(await api.get(`/api/reports?siteId=${site.id}`));
    };
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site?.id]);

    const generate = async () => {
        setBusy(true);
        try {
            const r = await api.get(`/api/sites/${site.id}/report`);
            setCurrent(r);
            await load();
        } finally {
            setBusy(false);
        }
    };
    const openPrint = (r) => {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(reportHtml(r, site));
        w.document.close();
    };
    const download = (r) => {
        const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${site.code}-report-${r.generatedAt.slice(0, 10)}.json`;
        a.click();
    };

    if (!site) return null;
    return (
        <>
            <Section title="보고서 생성">
                <div className="gi-muted">현재 시점의 시설·태양광 건전성·핫스팟·알림·임무·작업지시를 종합한 점검 보고서를 생성합니다.</div>
                <Button tone="primary" size="md" disabled={busy} onClick={generate}>{busy ? '생성 중…' : '종합 점검 보고서 생성'}</Button>
            </Section>
            {current && (
                <Section title={`생성됨 · ${fmtTime(current.generatedAt)}`} right={<div className="gi-row"><Button size="xs" onClick={() => openPrint(current)}>인쇄/PDF</Button><Button size="xs" onClick={() => download(current)}>JSON</Button></div>}>
                    <div className="gi-report">
                        <h4>권고 조치</h4>
                        <ul>{current.recommendations.map((x, i) => <li key={i}><Badge size="xs" color={x.priority === 'high' ? '#ef4444' : x.priority === 'medium' ? '#f59e0b' : '#38bdf8'}>{x.priority === 'high' ? '긴급' : x.priority === 'medium' ? '보통' : '낮음'}</Badge> {x.text}</li>)}</ul>
                        <h4>요약</h4>
                        <div className="gi-muted">시설 {current.summary.facilities} (가동 {current.summary.operating}) · PV {fmt(current.summary.pvCapacityKwp)} kWp / {current.summary.pvArrays}개 · 핫스팟 {current.summary.hotspots} (심각 {current.summary.hotspotsCritical}) · 미확인 알림 {current.summary.openAlerts} · 데이터셋 {current.summary.datasets}</div>
                    </div>
                </Section>
            )}
            <Section title={`이력 (${reports.length})`}>
                <div className="gi-list">
                    {reports.map((r) => (
                        <div key={r.id} className="gi-list-item">
                            <div className="min-w-0 flex-1">
                                <div className="gi-list-title">{fmtTime(r.generatedAt)} · {r.period === 'daily' ? '일간' : r.period}</div>
                                <div className="gi-list-sub">핫스팟 {r.summary.hotspots} · 심각 어레이 {r.summary.pvCritical} · 미확인 알림 {r.summary.openAlerts}</div>
                            </div>
                            <Button size="xs" onClick={() => openPrint(r)}>열기</Button>
                        </div>
                    ))}
                    {!reports.length && <div className="gi-empty">생성된 보고서가 없습니다</div>}
                </div>
            </Section>
        </>
    );
}
