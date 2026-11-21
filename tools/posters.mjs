#!/usr/bin/env node
/**
 * Renders the static poster images used when the 3D stage cannot run (no WebGL, or
 * only a software renderer) and by the social preview image. Each poster is a capture
 * of the real 3D scene in one of its settled states, so the fallback always matches
 * the live experience.
 *
 * Start the site first (npm run dev, or npm run preview after a build), then:
 *
 *   node tools/posters.mjs --url http://127.0.0.1:4321/
 *   node tools/posters.mjs --url http://127.0.0.1:4322/ --out shots/posters
 *
 * Options: --url <address> the running site (default http://127.0.0.1:4321/),
 *          --out <dir> where the images are written (default src/assets/posters)
 */
import { mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { allowSoftwareWebGL, launch, option, wait } from './lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = option('url', 'http://127.0.0.1:4321/');
const outOption = option('out');
// A relative --out is taken from the folder the command is run in.
const outDir = outOption ? resolve(outOption) : resolve(root, 'src/assets/posters');

mkdirSync(outDir, { recursive: true });

const browser = await launch();

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  // The posters are captures of the live scene, so the page's refusal of a software
  // renderer is lifted here: headless Chrome has nothing else to draw with.
  await allowSoftwareWebGL(page);
  // Reduced motion makes every scene jump straight to its settled pose.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.stage-canvas.is-ready', { timeout: 30000 });
  // Everything that is not the scene is hidden or made transparent for the capture.
  // The page can reload under a dev server (hot reload), which would drop an injected
  // style element, so the overrides are checked before every capture.
  const OVERRIDES = `
    html, body, main, section, .site-header, .story__stage, .shortlist__stage, .stage { background: transparent !important; box-shadow: none !important; }
    .stage__labels, .stage__note, .stage__caption, .rail, .site-header { visibility: hidden !important; }
    astro-dev-toolbar { display: none !important; }
    *, *::before, *::after { scroll-behavior: auto !important; }
  `;
  const ensureOverrides = async () => {
    const present = await page.evaluate(() => Boolean(document.querySelector('style[data-poster-overrides]')));
    if (present) return;
    await page.waitForSelector('.stage-canvas.is-ready', { timeout: 30000 });
    await page.evaluate((css) => {
      const style = document.createElement('style');
      style.setAttribute('data-poster-overrides', '');
      style.textContent = css;
      document.head.append(style);
    }, OVERRIDES);
  };
  await ensureOverrides();

  const capture = async (slotSelector, name) => {
    await ensureOverrides();
    // The clip is in document coordinates, so the scroll offset is added to the slot's box.
    const box = await page.evaluate((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
    }, slotSelector);
    const png = await page.screenshot({ clip: box, omitBackground: true, type: 'png' });
    const out = resolve(outDir, `${name}.webp`);
    const info = await sharp(png).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(out);
    const shown = relative(root, out);
    console.log('wrote', shown.startsWith('..') ? out : shown.replaceAll('\\', '/'), `${info.width}x${info.height}`, `${info.size} bytes`);
  };

  /**
   * Scroll, then wait until the one canvas has moved into this slot and the scene has
   * settled. A fixed pause alone is not enough on a busy machine: the capture could
   * land before the stage had switched scenes.
   */
  const settle = async (slotSelector, top) => {
    await ensureOverrides();
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await page.waitForFunction((selector) => Boolean(document.querySelector(`${selector} canvas.stage-canvas`)), { timeout: 20000 }, slotSelector);
    await wait(1500);
  };

  // ---- worked example: opening plus the four chapters
  const stepTops = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-step]')).map((el) => el.getBoundingClientRect().top + window.scrollY),
  );
  const stops = [0, ...stepTops.map((top) => Math.round(top - 40))];
  for (let i = 0; i < stops.length; i++) {
    await settle('[data-stage-slot]', stops[i]);
    await capture('[data-stage-slot]', `unit-${i}`);
  }

  // ---- staffing: one poster per phase
  const phaseTops = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-phase]')).map((el) => el.getBoundingClientRect().top + window.scrollY),
  );
  const viewportHeight = page.viewport().height;
  for (let i = 0; i < phaseTops.length; i++) {
    await settle('[data-team-slot]', Math.round(phaseTops[i] - viewportHeight * 0.35));
    await capture('[data-team-slot]', `team-${i}`);
  }
} finally {
  await browser.close();
}
