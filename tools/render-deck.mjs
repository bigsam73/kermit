// docs/deck/deck.html → PDF (16:9 슬라이드). 사용: node tools/render-deck.mjs docs/deck
import { chromium } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const here = path.resolve(process.argv[2] || 'docs/deck');
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(pathToFileURL(path.join(here, 'deck.html')).href, { waitUntil: 'load' });
await p.waitForTimeout(1500);
await p.pdf({ path: path.join(here, 'PICT_INDUSTRIAL_소개.pdf'), width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
await b.close();
console.log('ok');
