// 백그라운드 작업(타일 생성, 열화상 분석, 사진 인덱싱) 레지스트리
import { randomUUID } from 'node:crypto';
import { broadcast } from './sim.js';

const jobs = new Map();

export function createJob(type, meta = {}) {
    const job = { id: randomUUID(), type, status: 'queued', progress: 0, log: [], startedAt: new Date().toISOString(), finishedAt: null, error: null, ...meta };
    jobs.set(job.id, job);
    broadcast('job', summarize(job));
    return job;
}

export function updateJob(id, patch) {
    const job = jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    if (patch.logLine) {
        job.log.push(String(patch.logLine).trim().slice(0, 300));
        if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
        delete job.logLine;
    }
    broadcast('job', summarize(job));
    return job;
}

export function finishJob(id, error = null, result = null) {
    return updateJob(id, { status: error ? 'error' : 'done', error: error ? String(error.message || error) : null, result, progress: error ? undefined : 100, finishedAt: new Date().toISOString() });
}

export function listJobs() {
    return Array.from(jobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50).map(summarize);
}

export function getJob(id) {
    return jobs.get(id) || null;
}

function summarize(job) {
    return { id: job.id, type: job.type, status: job.status, progress: job.progress, datasetId: job.datasetId, siteId: job.siteId, error: job.error, startedAt: job.startedAt, finishedAt: job.finishedAt, lastLog: job.log[job.log.length - 1] || '', result: job.result || null };
}

// 작업 실행 헬퍼: 동기 함수/프라미스를 감싸 상태를 갱신한다
export async function runJob(type, meta, fn) {
    const job = createJob(type, meta);
    updateJob(job.id, { status: 'running' });
    try {
        const result = await fn((patch) => updateJob(job.id, patch));
        finishJob(job.id, null, result);
        return { job, result };
    } catch (err) {
        console.error(`[job:${type}]`, err.message);
        finishJob(job.id, err);
        return { job, error: err };
    }
}
