// 산업단지 API 클라이언트 (Vite dev 프록시 또는 동일 오리진)
const BASE = import.meta.env.VITE_INDUSTRIAL_API || '';

async function request(path, options = {}) {
    const res = await fetch(`${BASE}${path}`, {
        headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
        ...options,
        body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
    });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const j = await res.json();
            msg = j.error || msg;
        } catch {
            /* ignore */
        }
        throw new Error(msg);
    }
    return res.json();
}

export const api = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    upload: (p, formData) => request(p, { method: 'POST', body: formData }),
    url: (p) => `${BASE}${p}`,
};

export function subscribeEvents(handlers) {
    let es = null;
    let closed = false;
    const connect = () => {
        if (closed) return;
        es = new EventSource(`${BASE}/events`);
        Object.entries(handlers).forEach(([event, fn]) => {
            es.addEventListener(event, (e) => {
                try {
                    fn(JSON.parse(e.data));
                } catch {
                    /* ignore */
                }
            });
        });
        es.onerror = () => {
            es.close();
            setTimeout(connect, 3000);
        };
    };
    connect();
    return () => {
        closed = true;
        es?.close();
    };
}
