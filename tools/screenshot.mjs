import fs from 'node:fs';
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://localhost:3200/';
const out = process.argv[3] || 'shot.png';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const cdp = await page.context().newCDPSession(page);
const shot = async (file) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(data, 'base64')); };
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => errors.push('goto: ' + e.message));
await page.waitForTimeout(Number(process.env.WAIT_MS || 10000));
const steps = (process.env.STEPS || '').split('|').filter(Boolean);
for (const s of steps) {
  const i = s.indexOf(':'); const kind = s.slice(0, i); const arg = s.slice(i + 1);
  try {
    if (kind === 'click') { await page.locator(arg).first().click({ timeout: 8000, noWaitAfter: true, force: true }); await page.waitForTimeout(2500); }
    if (kind === 'wait') await page.waitForTimeout(Number(arg));
    if (kind === 'eval') console.log('EVAL:', String(JSON.stringify(await page.evaluate(arg))).slice(0, 800));
    if (kind === 'shot') await shot(arg);
  } catch (e) { errors.push(`step ${s}: ${e.message.slice(0, 200)}`); }
}
console.log('ERRORS:\n' + (errors.length ? [...new Set(errors)].slice(0, 40).join('\n') : '(none)'));
await shot(out);
await browser.close();
