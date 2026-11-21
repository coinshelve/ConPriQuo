#!/usr/bin/env node
/**
 * Visual QA helper: capture exact-size screenshots of a running build with a locally
 * installed Chrome or Edge (no browser download). Used during development to inspect
 * the page at desktop, tablet and phone sizes, and to render the 3D poster images.
 *
 *   node tools/shot.mjs --url http://127.0.0.1:4321/ --out shots/home --width 1440 --height 900
 *   node tools/shot.mjs --url ... --out shots/m --width 390 --height 844 --dpr 3 --mobile --scroll 0,800,1600
 *   node tools/shot.mjs --url ... --out shots/full --full
 *   node tools/shot.mjs --url ... --out poster --selector ".stage-canvas" --transparent
 *
 * Options: --wait <ms> settle time, --eval "<js>" run in page before capture,
 *          --reduced-motion, --no-webgl (simulate a device without WebGL), --console
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(2);
}

const url = opt('url');
const out = resolve(opt('out', 'shots/shot'));
if (!url) {
  console.error('Missing --url');
  process.exit(2);
}
const width = Number(opt('width', 1440));
const height = Number(opt('height', 900));
const dpr = Number(opt('dpr', 1));
const wait = Number(opt('wait', 1200));
const scrolls = opt('scroll', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const selector = opt('selector');
const evalScript = opt('eval');
const isMobile = flag('mobile');

mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--force-color-profile=srgb',
    ...(flag('no-webgl') ? ['--disable-gpu', '--disable-3d-apis'] : []),
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr, isMobile, hasTouch: isMobile });
  if (flag('reduced-motion')) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  const messages = [];
  page.on('console', (m) => messages.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => messages.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, wait));
  if (evalScript) {
    const result = await page.evaluate(evalScript);
    if (result !== undefined) console.log('eval:', typeof result === 'string' ? result : JSON.stringify(result));
    await new Promise((r) => setTimeout(r, wait));
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
      await new Promise((r) => setTimeout(r, Math.max(500, wait / 2)));
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
