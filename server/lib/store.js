// JSON 파일 기반 경량 데이터 저장소 (산업단지 관제 플랫폼)
// 외부 DB 없이 data/db.json 하나로 모든 컬렉션을 관리한다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const COLLECTIONS = [
    'sites', 'facilities', 'panelArrays', 'datasets', 'alerts', 'hotspots',
    'inspections', 'missions', 'docks', 'sensors', 'photos', 'reports', 'workOrders', 'parcels', 'drawings',
];

export class Store {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
        this.data.meta = { createdAt: new Date().toISOString(), version: 1 };
        this.saveTimer = null;
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                for (const c of COLLECTIONS) this.data[c] = Array.isArray(raw[c]) ? raw[c] : [];
                this.data.meta = raw.meta || this.data.meta;
            }
        } catch (err) {
            console.error('[store] load failed, starting empty:', err.message);
        }
    }

    save(immediate = false) {
        if (immediate) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.write();
            return;
        }
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.write();
        }, 300);
    }

    write() {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tmp = `${this.filePath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
            fs.renameSync(tmp, this.filePath);
        } catch (err) {
            console.error('[store] save failed:', err.message);
        }
    }

    list(collection, filter = null) {
        const rows = this.data[collection] || [];
        if (!filter) return rows;
        return rows.filter((row) => Object.entries(filter).every(([k, v]) => v === undefined || row[k] === v));
    }

    get(collection, id) {
        return (this.data[collection] || []).find((row) => row.id === id) || null;
    }

    insert(collection, row) {
        const now = new Date().toISOString();
        const record = { id: row.id || randomUUID(), createdAt: now, updatedAt: now, ...row };
        if (!this.data[collection]) this.data[collection] = [];
        this.data[collection].push(record);
        this.save();
        return record;
    }

    update(collection, id, patch) {
        const rows = this.data[collection] || [];
        const idx = rows.findIndex((row) => row.id === id);
        if (idx < 0) return null;
        rows[idx] = { ...rows[idx], ...patch, id, updatedAt: new Date().toISOString() };
        this.save();
        return rows[idx];
    }

    upsert(collection, row) {
        if (row.id && this.get(collection, row.id)) return this.update(collection, row.id, row);
        return this.insert(collection, row);
    }

    remove(collection, id) {
        const rows = this.data[collection] || [];
        const idx = rows.findIndex((row) => row.id === id);
        if (idx < 0) return false;
        rows.splice(idx, 1);
        this.save();
        return true;
    }

    replaceAll(collection, rows) {
        this.data[collection] = rows;
        this.save();
    }

    isEmpty() {
        return COLLECTIONS.every((c) => (this.data[c] || []).length === 0);
    }
}
