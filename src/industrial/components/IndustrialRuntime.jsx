// 부트스트랩 · SSE 구독 · 선택 동기화 (UI 없음)
import { useEffect } from 'react';
import useIndustrialStore from '../store';
import useStore from '../../store/useStore';
import { subscribeEvents } from '../api';

export default function IndustrialRuntime() {
    const bootstrap = useIndustrialStore((s) => s.bootstrap);
    const inspector = useStore((s) => s.inspector);
    const setSelected = useIndustrialStore((s) => s.setSelected);

    useEffect(() => {
        bootstrap();
        const st = useIndustrialStore.getState;
        // 디버깅용 전역 노출 (브라우저 콘솔: __gi.getState(), __godseye.getState().viewerRef)
        window.__gi = useIndustrialStore;
        window.__godseye = useStore;
        const unsubscribe = subscribeEvents({
            telemetry: (p) => st().onTelemetry(p),
            job: (j) => {
                st().onJob(j);
                if (j.status === 'done' && (j.type === 'dataset-process' || j.type === 'photo-index')) {
                    st().refreshCollection('datasets');
                    if (j.type === 'photo-index') st().refreshCollection('photos');
                }
            },
            dataset: (d) => st().onDataset(d),
            alerts: () => { st().refreshCollection('alerts'); st().refreshSummary(); },
            thermal: () => { st().refreshCollection('hotspots'); st().refreshCollection('panelArrays'); st().refreshCollection('inspections'); st().refreshSummary(); },
            photos: () => st().refreshCollection('photos'),
            facilities: () => st().refreshCollection('facilities'),
            parcels: () => st().refreshCollection('parcels'),
            drawings: () => st().refreshCollection('drawings'),
            panelArrays: () => st().refreshCollection('panelArrays'),
            sensors: () => st().refreshCollection('sensors'),
            docks: () => st().refreshCollection('docks'),
            missions: () => st().refreshCollection('missions'),
            workOrders: () => st().refreshCollection('workOrders'),
            sites: () => st().refreshSites(),
            reseed: () => window.location.reload(),
        });
        const envTimer = setInterval(() => st().refreshEnvironment(), 10 * 60 * 1000);
        return () => {
            unsubscribe();
            clearInterval(envTimer);
        };
    }, [bootstrap]);

    // 지구본 클릭 → 산업단지 객체 선택 동기화
    useEffect(() => {
        if (inspector?._industrialType && inspector._industrialType !== 'site') {
            setSelected({ type: inspector._industrialType, id: inspector._industrialId });
        } else if (inspector === null) {
            setSelected(null);
        }
    }, [inspector, setSelected]);

    return null;
}
