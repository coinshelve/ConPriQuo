#!/usr/bin/env node
/**
 * Renders the static poster images used when WebGL is unavailable (and by the social
 * preview image). Each poster is a capture of the real 3D scene in one of its settled
 * states, so the fallback always matches the live experience.
 *
 * Start the site first (npm run dev, or npm run preview after a build), then:
 *
 *   node tools/posters.mjs --url http://127.0.0.1:4321/
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/assets/posters');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const url = opt('url', 'http://127.0.0.1:4321/');

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

mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--force-color-profile=srgb'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  // Reduced motion makes every scene jump straight to its settled pose.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.stage-canvas.is-ready', { timeout: 30000 });
  await page.addStyleTag({
    content: `
      html, body, .site-header, .story__stage, .shortlist__stage, .stage { background: transparent !important; box-shadow: none !important; }
      .stage__labels, .stage__note, .stage__caption, .rail, .site-header { visibility: hidden !important; }
      astro-dev-toolbar { display: none !important; }
      *, *::before, *::after { scroll-behavior: auto !important; }
    `,
  });

  const capture = async (slotSelector, name) => {
    // The clip is in document coordinates, so the scroll offset is added to the slot's box.
    const box = await page.evaluate((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
    }, slotSelector);
    const png = await page.screenshot({ clip: box, omitBackground: true, type: 'png' });
    const out = resolve(outDir, `${name}.webp`);
    const info = await sharp(png).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(out);
    console.log('wrote', `src/assets/posters/${name}.webp`, `${info.width}x${info.height}`, `${info.size} bytes`);
  };

  // ---- worked example: opening plus the four chapters
  const stepTops = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-step]')).map((el) => el.getBoundingClientRect().top + window.scrollY),
  );
  const stops = [0, ...stepTops.map((top) => Math.round(top - 40))];
  for (let i = 0; i < stops.length; i++) {
    await page.evaluate((top) => window.scrollTo(0, top), stops[i]);
    await wait(900);
    await capture('[data-stage-slot]', `unit-${i}`);
  }

  // ---- staffing: one poster per phase
  const phaseTops = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-phase]')).map((el) => el.getBoundingClientRect().top + window.scrollY),
  );
  for (let i = 0; i < phaseTops.length; i++) {
    await page.evaluate((top) => window.scrollTo(0, top - window.innerHeight * 0.35), phaseTops[i]);
    await wait(1100);
    await capture('[data-team-slot]', `team-${i}`);
  }
} finally {
  await browser.close();
}
