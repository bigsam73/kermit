// 다른 컴퓨터에서 PICT INDUSTRIAL 실측 데이터(3D Tiles·열화상) 폴더를 연결한다.
// 사용: node import-portable-data.mjs --project <godseye-industrial 폴더> [--data <PICT_INDUSTRIAL_DATA 폴더>] [--force]
//  - --data 를 생략하면 이 스크립트가 있는 폴더를 데이터 폴더로 본다.
//  - 데이터 폴더의 db.json(단지·데이터셋·핫스팟·필지)을 <project>/data/db.json 으로 복원하면서
//    manifest.json 에 적힌 상대 경로를 이 컴퓨터의 실제 경로로 바꿔 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(opt('data', here));
const project = opt('project');
const force = args.includes('--force');
if (!project) {
    console.error('사용법: node import-portable-data.mjs --project <godseye-industrial 폴더> [--data <데이터 폴더>] [--force]');
    process.exit(1);
}
const manifestFile = path.join(dataRoot, 'manifest.json');
const dbFile = path.join(dataRoot, 'db.json');
if (!fs.existsSync(manifestFile) || !fs.existsSync(dbFile)) {
    console.error(`manifest.json / db.json 이 없습니다: ${dataRoot}`);
    process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const abs = (rel) => path.join(dataRoot, ...rel.split('/'));

let ok = 0;
let warn = 0;
for (const ds of db.datasets || []) {
    const m = manifest.items[ds.id];
    if (m) {
        if (m.sourcePath) ds.sourcePath = abs(m.sourcePath);
        else if (m.sourcePath === null) { ds.sourcePath = null; ds.sourceMissing = true; }
        if (m.tilesDir) ds.tilesDir = abs(m.tilesDir);
        const check = [ds.sourcePath, ds.tilesDir].filter(Boolean);
        const missing = check.filter((p) => !fs.existsSync(p));
        if (missing.length) { warn++; console.warn(`! ${ds.id}: 파일 없음 → ${missing.join(', ')}`); } else ok++;
    } else {
        // 이 폴더에 포함되지 않은 데이터셋: 원래 경로가 없으면 기본 표시를 끈다
        const exists = (ds.sourcePath && fs.existsSync(ds.sourcePath)) || (ds.tilesDir && fs.existsSync(ds.tilesDir));
        if (!exists) { ds.visibleByDefault = false; ds.sourceMissing = true; ds.autoProcess = false; console.log(`- ${ds.id}: 이 컴퓨터에 원본 없음 → 기본 표시 해제`); }
    }
}
const outDir = path.join(path.resolve(project), 'data');
const outFile = path.join(outDir, 'db.json');
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outFile)) {
    if (!force) {
        console.error(`이미 ${outFile} 이(가) 있습니다. 덮어쓰려면 --force (기존 파일은 db.json.bak 로 보관)`);
        process.exit(2);
    }
    fs.copyFileSync(outFile, `${outFile}.bak`);
}
fs.writeFileSync(outFile, JSON.stringify(db, null, 2));
console.log(`\n완료: 데이터셋 ${ok}건 연결 (경고 ${warn}건) → ${outFile}`);
console.log('이제 프로젝트 폴더에서 npm install → npm run build → npm start 후 http://localhost:3200/ 로 접속하세요.');
