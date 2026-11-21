#!/usr/bin/env node
/**
 * Visual QA helper: capture exact-size screenshots of a running build with a locally
 * installed Chrome or Edge (no browser download). Used during development to inspect
 * the page at desktop, tablet and phone sizes.
 *
 *   node tools/shot.mjs --url http://127.0.0.1:4321/ --out shots/home --width 1440 --height 900
 *   node tools/shot.mjs --url ... --out shots/m --width 390 --height 844 --dpr 3 --mobile --scroll 0,800,1600
 *   node tools/shot.mjs --url ... --out shots/full --full
 *   node tools/shot.mjs --url ... --out part --selector ".doc"
 *
 * Options: --wait <ms> settle time, --eval "<js>" run in page before capture,
 *          --at "<selector>" scroll that element to the top of the viewport first,
 *          --reduced-motion, --gpu (real graphics hardware), --console,
 *          --no-webgl (a device with no 3D support),
 *          --strict (do not lift the page's refusal of software WebGL)
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { allowSoftwareWebGL, flag, launch, option, wait } from './lib/browser.mjs';

const url = option('url');
const out = resolve(option('out', 'shots/shot'));
if (!url) {
  console.error('Missing --url');
  process.exit(2);
}
const width = Number(option('width', 1440));
const height = Number(option('height', 900));
const dpr = Number(option('dpr', 1));
const settle = Number(option('wait', 1200));
const scrolls = option('scroll', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const selector = option('selector');
const at = option('at');
const evalScript = option('eval');
const isMobile = flag('mobile');

mkdirSync(dirname(out), { recursive: true });

const browser = await launch({ gpu: flag('gpu'), webgl: !flag('no-webgl') });

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr, isMobile, hasTouch: isMobile });
  if (!flag('strict')) await allowSoftwareWebGL(page);
  if (flag('reduced-motion')) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  const messages = [];
  page.on('console', (m) => messages.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => messages.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; } astro-dev-toolbar { display: none !important; }' });
  await wait(settle);
  if (at) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Selector not found: ${sel}`);
      const header = document.querySelector('[data-header]')?.getBoundingClientRect().height ?? 0;
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - header));
    }, at);
    await wait(settle);
  }
  if (evalScript) {
    const result = await page.evaluate(evalScript);
    if (result !== undefined) console.log('eval:', typeof result === 'string' ? result : JSON.stringify(result));
    await wait(settle);
  }

  const capture = async (path) => {
    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`Selector not found: ${selector}`);
      await el.screenshot({ path, omitBackground: flag('transparent') });
    } else {
      await page.screenshot({ path, fullPage: flag('full'), omitBackground: flag('transparent') });
    }
    console.log('wrote', path);
  };

  if (scrolls.length) {
    for (const y of scrolls) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await wait(Math.max(500, settle / 2));
      await capture(`${out}-${String(y).padStart(5, '0')}.png`);
    }
  } else {
    await capture(`${out}.png`);
  }

  if (flag('console') || messages.some((m) => /error|failed/i.test(m))) {
    console.log('--- page console ---');
    for (const m of messages) console.log(m);
  }
} finally {
  await browser.close();
}
