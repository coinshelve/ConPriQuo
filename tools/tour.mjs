#!/usr/bin/env node
/**
 * Captures a screenshot tour of the homepage: one image per chapter, at a desktop, a
 * tablet and a phone size. Used for visual review.
 *
 *   node tools/tour.mjs --url http://127.0.0.1:4322/ --out shots/tour
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const url = opt('url', 'http://127.0.0.1:4322/');
const outDir = resolve(opt('out', 'shots/tour'));
const only = opt('only', '');

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.');
  process.exit(2);
}

const PROFILES = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'tablet', width: 820, height: 1180, dpr: 1, mobile: true },
  { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true },
].filter((p) => !only || only.split(',').includes(p.name));

/** Stops along the page: a selector and how far below the header its top should sit. */
const STOPS = [
  { name: 'opening', selector: '#top', offset: -200 },
  { name: 'configure', selector: '#configure', offset: 0 },
  { name: 'configure-bench', selector: '[data-bench]', offset: 20 },
  { name: 'price', selector: '#price .sheet', offset: 20 },
  { name: 'price-build', selector: '.build', offset: 20 },
  { name: 'quote', selector: '#quote .doc', offset: 20 },
  { name: 'handoff', selector: '#handoff .map', offset: 120 },
  { name: 'practices', selector: '#practices', offset: -40 },
  { name: 'practices-columns', selector: '.practices__cols', offset: 20 },
  { name: 'engagements', selector: '#engagements', offset: -60 },
  { name: 'staffing', selector: '#staffing', offset: -40 },
  { name: 'staffing-source', selector: '[data-phase="source"]', offset: 260 },
  { name: 'staffing-coordinate', selector: '[data-phase="coordinate"]', offset: 260 },
  { name: 'delivery', selector: '#delivery', offset: -40 },
  { name: 'brief', selector: '#brief', offset: -40 },
  { name: 'footer', selector: 'footer.footer', offset: 0 },
];

mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--force-color-profile=srgb'],
});

try {
  for (const profile of PROFILES) {
    const page = await browser.newPage();
    await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.dpr, isMobile: profile.mobile, hasTouch: profile.mobile });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; } astro-dev-toolbar { display: none !important; }' });
    await wait(2800);
    let index = 0;
    for (const stop of STOPS) {
      const y = await page.evaluate(
        (selector, offset) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const header = document.querySelector('[data-header]')?.getBoundingClientRect().height ?? 0;
          const stage = document.querySelector('.story__stage');
          // on small screens the sticky stage also covers the top of the viewport
          const sticky = window.matchMedia('(min-width: 64rem)').matches ? 0 : stage && el.closest('[data-story]') ? stage.getBoundingClientRect().height : 0;
          return Math.max(0, el.getBoundingClientRect().top + window.scrollY - header - sticky - offset);
        },
        stop.selector,
        stop.offset,
      );
      if (y === null) continue;
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await wait(1500);
      index += 1;
      const file = resolve(outDir, `${profile.name}-${String(index).padStart(2, '0')}-${stop.name}.png`);
      await page.screenshot({ path: file });
      console.log('wrote', file);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
