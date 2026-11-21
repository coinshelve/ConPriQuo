#!/usr/bin/env node
/**
 * Automated QA against a running build. Exercises the page the way a visitor would and
 * reports what it finds; it exits non-zero if any check fails.
 *
 *   npm run build && npm run preview     (in another terminal)
 *   node tools/qa.mjs --url http://127.0.0.1:4322/
 *
 * Checks: console and network errors, horizontal overflow at eight widths, document
 * outline, copy rules, the configurator's rules, pricing and approvals, the brief
 * composer, reduced motion, no WebGL, no JavaScript, axe accessibility rules, and
 * loading metrics.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const url = opt('url', 'http://127.0.0.1:4322/');

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

const GL_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, { width = 1440, height = 900, mobile = false, reducedMotion = false, javascript = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (!javascript) await page.setJavaScriptEnabled(false);
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  if (javascript) await page.evaluate(() => document.fonts.ready);
  return { page, problems };
}

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--hide-scrollbars', ...GL_ARGS] });

try {
  // ------------------------------------------------------------ 1. clean load
  {
    const { page, problems } = await open(browser);
    await page.waitForSelector('.stage-canvas.is-ready', { timeout: 30000 }).catch(() => {});
    await wait(1500);
    record('loads without console, page or network errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    record('3D stage starts (canvas ready)', await page.evaluate(() => Boolean(document.querySelector('.stage-canvas.is-ready'))));

    // ---------------------------------------------------------- 2. document
    const doc = await page.evaluate(() => {
      const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => ({ level: Number(h.tagName[1]), text: text(h) }));
      const visibleText = document.body.innerText;
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const hashes = anchors.map((a) => a.getAttribute('href')).filter((h) => h.startsWith('#'));
      const missing = hashes.filter((h) => h.length > 1 && !document.getElementById(h.slice(1)));
      const internal = anchors
        .map((a) => a.getAttribute('href'))
        .filter((h) => !h.startsWith('#') && !h.startsWith('mailto:') && !h.startsWith('tel:') && !/^https?:\/\//.test(h));
      const planned = Array.from(document.querySelectorAll('.site-header__pages li, .site-menu__pages li, .footer__group li'));
      return {
        h1: headings.filter((h) => h.level === 1).length,
        skips: headings.filter((h, i) => i > 0 && h.level > headings[i - 1].level + 1).map((h) => h.text),
        headingCount: headings.length,
        emDash: (visibleText.match(/\u2014/g) || []).length,
        missing,
        internal,
        plannedCount: planned.length,
        plannedLinked: planned.filter((li) => li.querySelector('a') || li.closest('a')).length,
        imagesWithoutAlt: Array.from(document.querySelectorAll('img')).filter((img) => !img.hasAttribute('alt')).length,
        title: document.title,
        titleLength: document.title.length,
        description: document.querySelector('meta[name="description"]')?.content.length ?? 0,
        canonical: document.querySelector('link[rel="canonical"]')?.href ?? '',
        jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => {
          try {
            return JSON.parse(s.textContent)['@graph'].map((node) => node['@type']);
          } catch {
            return 'INVALID';
          }
        }),
        lang: document.documentElement.lang,
        words: visibleText.split(/\s+/).length,
      };
    });
    record('exactly one h1', doc.h1 === 1, `${doc.headingCount} headings`);
    record('heading levels never skip', doc.skips.length === 0, doc.skips.join(' | '));
    record('no em dash in visible copy', doc.emDash === 0, `${doc.emDash} found`);
    record('every in-page link has a target', doc.missing.length === 0, doc.missing.join(', '));
    record('no links to undeveloped pages', doc.internal.length === 0, doc.internal.join(', '));
    record('planned page names are text, not links', doc.plannedCount > 0 && doc.plannedLinked === 0, `${doc.plannedCount} names`);
    record('every image has an alt attribute', doc.imagesWithoutAlt === 0);
    record('title is 60 characters or fewer', doc.titleLength <= 60, `${doc.titleLength}: ${doc.title}`);
    record('meta description is 155 characters or fewer', doc.description > 60 && doc.description <= 155, `${doc.description}`);
    record('canonical URL present', doc.canonical.startsWith('https://'), doc.canonical);
    record('structured data parses', doc.jsonLd.length === 1 && doc.jsonLd[0] !== 'INVALID', JSON.stringify(doc.jsonLd));
    record('document language set', doc.lang === 'en', `${doc.words} words of visible copy`);

    // ---------------------------------------------------------- 3. configurator
    // Real mouse clicks are aimed at coordinates, so smooth scrolling is switched off
    // for the test run to keep those coordinates stable.
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    const pick = async (name, value) => {
      await page.evaluate(
        (n, v) => {
          const input = document.querySelector(`input[name="${n}"][value="${v}"]`);
          input.scrollIntoView({ block: 'center' });
          input.click();
        },
        name,
        value,
      );
      await wait(700);
    };
    const visibleParts = () =>
      page.evaluate(() => Array.from(document.querySelectorAll('[data-bom] tr[data-part]')).filter((r) => !r.hidden).map((r) => r.dataset.part));
    const out = (key) => page.evaluate((k) => document.querySelector(`[data-out="${k}"]`).textContent.trim(), key);

    record('default bill of materials', JSON.stringify(await visibleParts()) === JSON.stringify(['HX6-BASE', 'HX6-TL-GRP']));
    await pick('reach', 'long');
    let parts = await visibleParts();
    record('long reach adds the arm and a ballast block', parts.includes('HX6-ARM-14') && parts.includes('HX6-BAL-01'), parts.join(' '));
    const hook = await page.evaluate(() => {
      const input = document.querySelector('input[name="tool"][value="hook"]');
      const reason = document.querySelector('[data-reason="tool"]');
      return { disabled: input.getAttribute('aria-disabled'), described: input.getAttribute('aria-describedby'), reason: reason.hidden ? '' : reason.textContent };
    });
    record('constraint withdraws the hook and explains why', hook.disabled === 'true' && hook.reason.length > 20 && hook.described === 'reason-tool', hook.reason);
    await pick('tool', 'hook');
    record('a withdrawn option cannot be selected', await page.evaluate(() => !document.querySelector('input[name="tool"][value="hook"]').checked));
    await pick('tool', 'vacuum');
    parts = await visibleParts();
    record('vacuum lifter on diesel adds the pump kit', parts.includes('HX6-PMP-KIT'), parts.join(' '));
    await pick('power', 'electric');
    parts = await visibleParts();
    record('on electric the pump kit is removed', !parts.includes('HX6-PMP-KIT') && parts.includes('HX6-PWR-E'), parts.join(' '));
    const rules = await page.evaluate(() => Array.from(document.querySelectorAll('[data-rules] li[data-kind]')).map((li) => li.firstElementChild.textContent));
    record('rule log lists the rules that fired', rules.includes('C-01') && rules.includes('R-04') && rules.includes('B-07'), rules.join(' '));

    // quantity and discount
    await page.evaluate(() => document.querySelector('[data-qty="1"]').scrollIntoView({ block: 'center' }));
    for (let i = 0; i < 2; i++) {
      await page.click('[data-qty="1"]');
      await wait(250);
    }
    await wait(700);
    record('quantity 6 reaches the 5% volume tier', (await out('volumePercent')) === '5%' && (await out('quantity')) === '6');
    await page.evaluate(() => {
      const range = document.querySelector('[data-discount]');
      range.value = '12';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(700);
    let status = await out('approvalStatus');
    record('12% discount routes to the sales manager', /sales manager/.test(status) && !/finance/.test(status), status);
    await page.evaluate(() => {
      const range = document.querySelector('[data-discount]');
      range.value = '20';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(900);
    status = await out('approvalStatus');
    record('20% discount adds the finance director', /sales manager/.test(status) && /finance director/.test(status), status);
    const totals = await page.evaluate(() => {
      const n = (k) => Number(document.querySelector(`[data-out="${k}"]`).textContent.replace(/[^0-9]/g, ''));
      return { total: n('total'), total2: n('total2'), mapTotal: n('mapTotal'), unitNet: n('unitNet'), qty: n('quantity'), stamp: document.querySelector('[data-stamp]').dataset.state };
    });
    record(
      'total agrees across price build, quote document and field map',
      totals.total > 0 && totals.total === totals.total2 && totals.total === totals.mapTotal && totals.total === totals.unitNet * totals.qty,
      JSON.stringify(totals),
    );
    record('quote document shows the approval as pending', totals.stamp === 'pending');

    // ---------------------------------------------------------- 4. brief composer
    await page.evaluate(() => document.querySelector('[data-composer]').scrollIntoView({ block: 'start' }));
    await page.type('#brief-need', 'Sellers quote from spreadsheets & approvals happen by email.');
    await page.type('#brief-name', 'QA Tester');
    await wait(300);
    const brief = await page.evaluate(() => {
      const href = document.querySelector('[data-send]').getAttribute('href');
      return { href, preview: document.querySelector('[data-preview]').textContent };
    });
    const decoded = decodeURIComponent(brief.href);
    record(
      'brief composer builds a mailto with the typed brief',
      brief.href.startsWith('mailto:admin@conpriquo-solutions.in?subject=') && decoded.includes('spreadsheets & approvals') && decoded.includes('QA Tester'),
      `${brief.href.length} characters`,
    );
    await page.evaluate(() => document.querySelector('input[name="path"][value="staffing"]').click());
    await wait(300);
    const staffing = await page.evaluate(() => ({
      projectHidden: document.querySelector('[data-path-panel="project"]').hidden,
      staffingHidden: document.querySelector('[data-path-panel="staffing"]').hidden,
      preview: document.querySelector('[data-preview]').textContent,
    }));
    record('switching path swaps the fields and the brief', staffing.projectHidden && !staffing.staffingHidden && staffing.preview.startsWith('SKILL REQUIREMENT'));
    // intent link pre-fills an empty brief
    await page.evaluate(() => {
      document.querySelector('#brief-need').value = '';
      document.querySelector('.intent[data-brief-platform="Integration"]').click();
    });
    await wait(300);
    const intent = await page.evaluate(() => ({
      path: document.querySelector('input[name="path"]:checked').value,
      platform: document.querySelector('input[name="platform"][value="Integration"]').checked,
      need: document.querySelector('#brief-need').value,
    }));
    record('intent link opens the brief pre-written', intent.path === 'project' && intent.platform && intent.need.length > 20, intent.need);

    // ---------------------------------------------------------- 5. accessibility (axe)
    await page.evaluate(() => window.scrollTo(0, 0));
    // Let scroll-driven transitions settle: contrast is judged on steady states.
    await wait(2000);
    await page.addScriptTag({ content: readFileSync(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const axe = await page.evaluate(async () => {
      document.documentElement.classList.add('reveal-fallback');
      const run = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
      return run.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.target?.join(' ') }));
    });
    record('axe: no WCAG A or AA violations', axe.length === 0, axe.map((v) => `${v.id} [${v.impact}] x${v.nodes} ${v.sample}`).join(' | '));
    await page.close();
  }

  // ------------------------------------------------------------ 6. overflow at eight widths
  {
    const widths = [320, 360, 390, 768, 1024, 1280, 1440, 1920];
    const bad = [];
    for (const width of widths) {
      const { page } = await open(browser, { width, height: width < 700 ? 760 : 900, mobile: width < 700 });
      await wait(600);
      const overflow = await page.evaluate(async () => {
        const worst = { extra: 0, at: 0, who: '' };
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y <= total; y += Math.round(window.innerHeight * 0.8)) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
          const extra = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          if (extra > worst.extra) worst.extra = extra;
        }
        // find any element poking past the right edge
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('main *, header *, footer *')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.stage, .site-menu, .composer__preview, pre')) {
            worst.who = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`;
            break;
          }
        }
        return worst;
      });
      if (overflow.extra > 0 || overflow.who) bad.push(`${width}px: +${overflow.extra}px ${overflow.who}`);
      await page.close();
    }
    record(`no horizontal overflow at ${widths.join(', ')} px`, bad.length === 0, bad.join(' | '));
  }

  // ------------------------------------------------------------ 7. reduced motion
  {
    const { page, problems } = await open(browser, { reducedMotion: true });
    await wait(1500);
    const state = await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      const hidden = Array.from(document.querySelectorAll('[data-reveal], [data-lines]')).filter((el) => {
        const cs = getComputedStyle(el);
        return cs.opacity === '0' || cs.visibility === 'hidden';
      }).length;
      return { hidden };
    });
    record('reduced motion: nothing stays hidden, no errors', state.hidden === 0 && problems.length === 0, `${state.hidden} hidden, ${problems.length} problems`);
    await page.close();
  }

  // ------------------------------------------------------------ 8. no JavaScript
  {
    const { page } = await open(browser, { javascript: false });
    const state = await page.evaluate(() => {
      const hidden = Array.from(document.querySelectorAll('[data-reveal], [data-lines]')).filter((el) => {
        const cs = getComputedStyle(el);
        return cs.opacity === '0' || cs.visibility === 'hidden';
      }).length;
      return {
        hidden,
        h1: document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim(),
        bomRows: Array.from(document.querySelectorAll('[data-bom] tr[data-part]')).filter((r) => !r.hidden).length,
        total: document.querySelector('[data-out="total"]')?.textContent.trim(),
        composerShown: getComputedStyle(document.querySelector('[data-composer]')).display !== 'none',
        mailto: Boolean(document.querySelector('a[href^="mailto:"]')),
      };
    });
    record(
      'no JavaScript: content, default example and contact links are present',
      state.hidden === 0 && state.bomRows === 2 && Boolean(state.total) && state.mailto && !state.composerShown,
      JSON.stringify(state),
    );
    await page.close();
  }
} finally {
  await browser.close();
}

// ------------------------------------------------------------ 9. no WebGL (separate browser without 3D APIs)
{
  const noGl = await puppeteer.launch({ executablePath, headless: true, args: ['--hide-scrollbars', '--disable-gpu', '--disable-3d-apis'] });
  try {
    const { page, problems } = await open(noGl);
    await wait(3000);
    const state = await page.evaluate(() => ({
      noStage: document.documentElement.classList.contains('no-stage'),
      poster: document.querySelector('[data-stage-slot] img.stage-poster')?.getAttribute('src') ?? '',
      canvas: Boolean(document.querySelector('.stage-canvas')),
    }));
    record('no WebGL: static posters replace the canvas, no errors', state.noStage && state.poster.includes('unit-0') && problems.length === 0, JSON.stringify(state) + ' ' + problems.slice(0, 2).join(' | '));
    await page.close();
  } finally {
    await noGl.close();
  }
}

// ------------------------------------------------------------ 10. loading metrics (fresh browser, no cache)
{
  const perf = await puppeteer.launch({ executablePath, headless: true, args: ['--hide-scrollbars', ...GL_ARGS] });
  try {
    for (const profile of [
      { name: 'desktop', width: 1440, height: 900, mobile: false, cpu: 1 },
      { name: 'phone, 4x CPU slowdown', width: 390, height: 844, mobile: true, cpu: 4 },
    ]) {
      const page = await perf.newPage();
      await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.mobile ? 2 : 1, isMobile: profile.mobile, hasTouch: profile.mobile });
      const client = await page.createCDPSession();
      await client.send('Network.enable');
      await client.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      let bytes = 0;
      let requests = 0;
      client.on('Network.loadingFinished', (e) => {
        bytes += e.encodedDataLength;
        requests++;
      });
      await page.evaluateOnNewDocument(() => {
        window.__m = { lcp: 0, lcpEl: '', cls: 0, long: 0 };
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__m.lcp = e.startTime;
            window.__m.lcpEl = e.element ? e.element.tagName + '.' + String(e.element.className).split(' ')[0] : '';
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__m.long += Math.max(0, e.duration - 50);
        }).observe({ type: 'longtask', buffered: true });
      });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      await wait(3500);
      const m = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { ...window.__m, fcp: fcp ? fcp.startTime : 0, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd };
      });
      const line = `FCP ${Math.round(m.fcp)} ms, LCP ${Math.round(m.lcp)} ms (${m.lcpEl}), CLS ${m.cls.toFixed(3)}, blocking ${Math.round(m.long)} ms, ${requests} requests, ${(bytes / 1024).toFixed(0)} KB transferred`;
      record(`metrics, ${profile.name}: LCP under 2.5 s and CLS under 0.1 (local server)`, m.lcp > 0 && m.lcp < 2500 && m.cls < 0.1, line);
      await page.close();
    }
  } finally {
    await perf.close();
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
