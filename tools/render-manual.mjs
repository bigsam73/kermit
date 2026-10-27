// docs/manual/manual.html → A4 PDF (쪽번호 포함). 사용: node tools/render-manual.mjs
import { chromium } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = path.resolve('docs/manual');
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(dir, 'manual.html')).href, { waitUntil: 'load' });
await p.waitForTimeout(1500);
await p.pdf({
    path: path.join(dir, 'PICT_INDUSTRIAL_사용자매뉴얼.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#94a3b8;display:flex;justify-content:space-between;padding:0 18mm"><span>PICT INDUSTRIAL 사용자 매뉴얼</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await b.close();
console.log('ok');
