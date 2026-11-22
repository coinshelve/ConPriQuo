#!/usr/bin/env node
/**
 * Captures a screenshot tour of the homepage: one image per chapter, plus the enquiry
 * dialog, at a desktop, a tablet and a phone size. Used for visual review.
 *
 *   node tools/tour.mjs --url http://127.0.0.1:4322/ --out shots/tour
 *   node tools/tour.mjs --only phone --stops opening,enquiry
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowSoftwareWebGL, launch, option, wait } from './lib/browser.mjs';

const url = option('url', 'http://127.0.0.1:4322/');
const outDir = resolve(option('out', 'shots/tour'));
const only = option('only', '');
const onlyStops = option('stops', '');

const PROFILES = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'laptop', width: 1280, height: 720, dpr: 1, mobile: false },
  { name: 'tablet', width: 820, height: 1180, dpr: 1, mobile: true },
  { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true },
].filter((p) => (only ? only.split(',').includes(p.name) : p.name !== 'laptop'));

/** Stops along the page: a selector and how far below the header its top should sit. */
const STOPS = [
  { name: 'opening', selector: '#top', offset: 2000 },
  { name: 'configure', selector: '#configure', offset: 0 },
  { name: 'configure-bench', selector: '[data-bench]', offset: 20 },
  { name: 'price', selector: '#price .sheet', offset: 20 },
  { name: 'price-build', selector: '.build', offset: 20 },
  { name: 'quote', selector: '#quote .doc', offset: 20 },
  { name: 'handoff', selector: '#handoff .map', offset: 120 },
  { name: 'practices', selector: '#practices', offset: -40 },
  { name: 'practices-columns', selector: '.practices__cols', offset: 20 },
  { name: 'engagements', selector: '#engagements', offset: -60 },
  { name: 'delivery', selector: '#delivery', offset: -40 },
  { name: 'staffing', selector: '#staffing', offset: -40 },
  { name: 'staffing-source', selector: '[data-phase="source"]', offset: 260 },
  { name: 'staffing-coordinate', selector: '[data-phase="coordinate"]', offset: 260 },
  { name: 'contact', selector: '#contact', offset: -40 },
  { name: 'footer', selector: 'footer.footer', offset: 0 },
].filter((s) => !onlyStops || onlyStops.split(',').includes(s.name));

mkdirSync(outDir, { recursive: true });
const browser = await launch();

try {
  for (const profile of PROFILES) {
    const page = await browser.newPage();
    await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.dpr, isMobile: profile.mobile, hasTouch: profile.mobile });
    await allowSoftwareWebGL(page);
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
          // on small screens a pinned stage also covers the top of the viewport: the
          // story's in the worked example, the shortlist's in the staffing section
          const stacked = !window.matchMedia('(min-width: 64rem)').matches;
          const pinned = el.closest('[data-story]')
            ? document.querySelector('.story__stage')
            : el.closest('.shortlist')
              ? document.querySelector('.shortlist__stage')
              : null;
          const sticky = stacked && pinned ? pinned.getBoundingClientRect().height : 0;
          return Math.max(0, el.getBoundingClientRect().top + window.scrollY - header - sticky - offset);
        },
        stop.selector,
        stop.offset,
      );
      if (y === null) {
        console.log('missing', stop.selector);
        continue;
      }
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await wait(1500);
      index += 1;
      const file = resolve(outDir, `${profile.name}-${String(index).padStart(2, '0')}-${stop.name}.png`);
      await page.screenshot({ path: file });
      console.log('wrote', file);
    }

    if (!onlyStops || onlyStops.split(',').includes('enquiry')) {
      // The enquiry dialog: empty, then with its validation messages showing.
      await page.evaluate(() => window.scrollTo(0, 0));
      await wait(400);
      await page.evaluate(() => document.querySelector('[data-enquiry]')?.click());
      await wait(900);
      await page.screenshot({ path: resolve(outDir, `${profile.name}-90-enquiry.png`) });
      await page.evaluate(() => document.querySelector('[data-enquiry-submit]')?.click());
      await wait(700);
      await page.screenshot({ path: resolve(outDir, `${profile.name}-91-enquiry-errors.png`) });
      console.log('wrote', resolve(outDir, `${profile.name}-90-enquiry.png`), 'and -91-enquiry-errors.png');
    }
    await page.close();
  }
} finally {
  await browser.close();
}
