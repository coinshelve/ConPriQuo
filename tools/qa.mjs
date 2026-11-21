#!/usr/bin/env node
/**
 * Automated QA against a running build. Exercises the page the way a visitor would and
 * reports what it finds; it exits non-zero if any check fails.
 *
 *   npm run build && npm run preview     (in another terminal)
 *   node tools/qa.mjs --url http://127.0.0.1:4322/
 *
 * Checks, in order:
 *    1. clean load: console, page and network errors, and the 3D stage starting
 *    2. document: outline, copy rules, links, metadata, structured data
 *    3. configurator: rules, bill of materials, pricing and approvals
 *    4. enquiry dialog: opening, validation, the email handoff, closing, focus
 *    5. axe accessibility rules, for the page and for the open dialog
 *    6. horizontal overflow at eight widths
 *    7. reduced motion
 *    8. no JavaScript
 *    9. software-only WebGL (the page should refuse it and show posters)
 *   10. no WebGL at all
 *   11. loading metrics
 *
 * Headless Chrome only has a software renderer, which the page refuses for its 3D
 * stage. Every check that needs the live scene lifts that refusal for its own page
 * (allowSoftwareWebGL); check 9 leaves it in place on purpose.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowSoftwareWebGL, launch, option, wait } from './lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = option('url', 'http://127.0.0.1:4322/');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const MAILTO_PREFIX = 'mailto:admin@conpriquo-solutions.in?subject=';
const MAILTO_LIMIT = 1900;

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/**
 * Opens the page. `softwareWebGL` lifts the page's refusal of a software renderer so
 * the 3D stage starts in headless Chrome; pass false to see what such a device gets.
 */
async function open(
  browser,
  { width = 1440, height = 900, mobile = false, reducedMotion = false, javascript = true, softwareWebGL = true } = {},
) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  if (softwareWebGL) await allowSoftwareWebGL(page);
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

/**
 * Waits for the enquiry dialog's opening transition, then ends whatever part of it is
 * still running, and returns how many animations that was. Drawing the 3D scene on a
 * software renderer can leave headless Chrome without a new frame for seconds, which
 * freezes the 420 ms transition part-way (the dialog stays faded and shifted). Position
 * and contrast are judged on the settled dialog, so the transition is taken to its end
 * state instead of waiting on frames that may not come.
 */
async function settleDialog(page, ms = 700) {
  await wait(ms);
  return page.evaluate(() => {
    const running = document.querySelector('[data-enquiry-dialog]').getAnimations({ subtree: true });
    for (const animation of running) {
      try {
        animation.finish();
      } catch {
        // an endless animation has no end state to jump to
      }
    }
    return running.length;
  });
}
const frozenNote = (count) => (count ? `the opening transition was still running after the wait and was ended by the test (${count} animations)` : '');

/** Splits a mailto link the way a mail handler does: address, then `&` separated fields. */
function parseMailto(href) {
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return '';
    }
  };
  const q = href.indexOf('?');
  const fields = q < 0 ? [] : href.slice(q + 1).split('&');
  const raw = {};
  for (const field of fields) {
    const eq = field.indexOf('=');
    raw[eq < 0 ? field : field.slice(0, eq)] = eq < 0 ? '' : field.slice(eq + 1);
  }
  return { fieldNames: Object.keys(raw), fieldCount: fields.length, rawBody: raw.body ?? '', body: decode(raw.body ?? ''), subject: decode(raw.subject ?? '') };
}

const browser = await launch();

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
        // U+2014, written as a code point so this file follows the house rule it enforces
        emDash: visibleText.split(String.fromCharCode(0x2014)).length - 1,
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
    const steadyScroll = () => page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    await steadyScroll();
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
    // The figures tick towards their new values, and on a loaded machine that can
    // outlast a fixed pause: read them only once two readings in a row agree.
    const readTotals = () =>
      page.evaluate(() => {
        const n = (k) => Number(document.querySelector(`[data-out="${k}"]`).textContent.replace(/[^0-9]/g, ''));
        return { total: n('total'), total2: n('total2'), mapTotal: n('mapTotal'), unitNet: n('unitNet'), qty: n('quantity'), stamp: document.querySelector('[data-stamp]').dataset.state };
      });
    let totals = await readTotals();
    for (let i = 0; i < 20; i++) {
      await wait(300);
      const next = await readTotals();
      const settled = JSON.stringify(next) === JSON.stringify(totals);
      totals = next;
      if (settled) break;
    }
    record(
      'total agrees across price build, quote document and field map',
      totals.total > 0 && totals.total === totals.total2 && totals.total === totals.mapTotal && totals.total === totals.unitNet * totals.qty,
      JSON.stringify(totals),
    );
    record('quote document shows the approval as pending', totals.stamp === 'pending');

    // ---------------------------------------------------------- 4. enquiry dialog
    // Anything other than a GET leaving the page during this section is a finding: this
    // build has no form endpoint, so the request may only go to the visitor's email app.
    const sent = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
    });
    // The handoff is a script navigation to a mailto link. It is recorded, then
    // cancelled, so a test run never opens an email app on the machine it runs on.
    const guardHandoff = () =>
      page.evaluate(() => {
        window.__handoffs = [];
        window.navigation?.addEventListener('navigate', (event) => {
          if (!event.destination.url.startsWith('mailto:')) return;
          window.__handoffs.push(event.destination.url);
          event.preventDefault();
        });
      });
    const HEADER_CONTROL = 'header [data-enquiry]';
    /** Resolves once the dialog has closed and the page has been released, or after 5 s. */
    const untilClosed = () =>
      page
        .waitForFunction(() => !document.querySelector('[data-enquiry-dialog]').open && !document.documentElement.classList.contains('has-dialog'), { timeout: 5000 })
        .catch(() => {});
    const dialogState = () =>
      page.evaluate((headerControl) => {
        const dialog = document.querySelector('[data-enquiry-dialog]');
        const active = document.activeElement;
        const shown = (el) => Boolean(el) && !el.hidden && el.getClientRects().length > 0;
        return {
          open: dialog.open,
          hasDialog: document.documentElement.classList.contains('has-dialog'),
          focus: active ? active.id || active.tagName.toLowerCase() : '',
          focusOnHeaderControl: active === document.querySelector(headerControl),
          formShown: shown(dialog.querySelector('[data-enquiry-form]')),
          doneShown: shown(dialog.querySelector('[data-enquiry-done]')),
          doneText: dialog.querySelector('[data-enquiry-done-text]').textContent.trim(),
          status: dialog.querySelector('[data-enquiry-status]').textContent.trim(),
          href: dialog.querySelector('a[data-enquiry-mailto]').getAttribute('href') ?? '',
          handoffs: window.__handoffs ?? [],
        };
      }, HEADER_CONTROL);
    const fieldState = () =>
      page.evaluate(() => {
        const state = {};
        for (const name of ['service', 'name', 'phone', 'email']) {
          const input = document.getElementById(`enq-${name}`);
          const field = input.closest('.field');
          const own = field.querySelector('.field__error');
          const describedBy = input.getAttribute('aria-describedby');
          const error = describedBy ? document.getElementById(describedBy) : null;
          state[name] = {
            invalid: field.classList.contains('is-invalid'),
            ariaInvalid: input.getAttribute('aria-invalid'),
            describedBy,
            pointsAtOwnError: Boolean(error) && error === own,
            errorShown: Boolean(error) && !error.hidden && error.getClientRects().length > 0 && getComputedStyle(error).visibility !== 'hidden',
            errorText: error ? error.textContent.trim() : '',
            ownErrorHidden: own.hidden || own.getClientRects().length === 0,
          };
        }
        return state;
      });
    const flagged = (f) => f.invalid && f.ariaInvalid === 'true' && f.pointsAtOwnError && f.errorShown && f.errorText.length > 0;
    const cleared = (f) => !f.invalid && f.ariaInvalid === null && f.describedBy === null && f.ownErrorHidden;
    const names = (fields, test) => Object.keys(fields).filter((name) => test(fields[name]));
    const openFromHeader = async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await wait(500);
      await page.click(HEADER_CONTROL);
      return settleDialog(page);
    };
    const submit = async () => {
      await page.click('[data-enquiry-submit]');
      await wait(400);
    };
    const retype = async (selector, text) => {
      await page.focus(selector);
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      if (text) await page.type(selector, text);
    };
    await guardHandoff();

    // a. every opener is a real link, so it still works without this script
    const openers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-enquiry]')).map((el) => ({ tag: el.tagName, href: el.getAttribute('href') ?? '', text: el.textContent.replace(/\s+/g, ' ').trim() })),
    );
    const notLinks = openers.filter((o) => o.tag !== 'A' || !o.href.startsWith('mailto:'));
    record(
      'enquiry: every opener is a mailto link',
      openers.length > 0 && notLinks.length === 0,
      notLinks.length ? notLinks.map((o) => `${o.tag.toLowerCase()} "${o.text}" href="${o.href}"`).join(' | ') : `${openers.length} links`,
    );

    // b. the header control opens it
    const headerText = await page.evaluate((sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? '', HEADER_CONTROL);
    await openFromHeader();
    let dlg = await dialogState();
    record(
      'enquiry: the header control opens the dialog with focus on the service select',
      /talk to us/i.test(headerText) && dlg.open && dlg.hasDialog && dlg.focus === 'enq-service',
      `control "${headerText}", open ${dlg.open}, has-dialog ${dlg.hasDialog}, focus on ${dlg.focus}`,
    );

    // c. an empty submission
    await submit();
    let fields = await fieldState();
    dlg = await dialogState();
    record(
      'enquiry: an empty submission marks service, name, phone and email, and says so',
      names(fields, flagged).length === 4 && dlg.focus === 'enq-service' && dlg.status.length > 0 && dlg.formShown && !dlg.doneShown,
      `flagged ${names(fields, flagged).join(' ') || 'none'}, focus on ${dlg.focus}, status "${dlg.status}"`,
    );

    // d. malformed phone and email
    const services = await page.evaluate(() => Array.from(document.querySelectorAll('#enq-service option')).map((o) => o.value).filter(Boolean));
    const entered = {
      service: services[0] ?? '',
      name: 'QA Tester',
      phone: '+91 98765 43210',
      email: 'qa.tester@example.com',
      requirement: 'Sellers quote from spreadsheets & approvals happen by email.',
    };
    await page.select('#enq-service', entered.service);
    await page.type('#enq-name', entered.name);
    await page.type('#enq-phone', '12ab');
    await page.type('#enq-email', 'name@company');
    await submit();
    fields = await fieldState();
    dlg = await dialogState();
    record(
      'enquiry: a malformed phone and a malformed email are both rejected',
      flagged(fields.phone) && flagged(fields.email) && cleared(fields.service) && cleared(fields.name) && dlg.focus === 'enq-phone' && !dlg.doneShown && dlg.handoffs.length === 0,
      `phone "12ab" ${flagged(fields.phone) ? 'rejected' : 'accepted'}, email "name@company" ${flagged(fields.email) ? 'rejected' : 'accepted'}, focus on ${dlg.focus}`,
    );

    // e. the error leaves as the field is corrected, and only that field's error
    await retype('#enq-phone', '+91 98');
    const partway = await fieldState();
    await page.type('#enq-phone', '765 43210');
    fields = await fieldState();
    record(
      'enquiry: correcting a field clears its error as you type',
      flagged(partway.phone) && cleared(fields.phone) && flagged(fields.email),
      `phone error while still too short: ${flagged(partway.phone)}, after correcting: ${!cleared(fields.phone)}, email error kept: ${flagged(fields.email)}`,
    );

    // f. a valid submission is handed to the email app, and nothing is posted
    await retype('#enq-email', entered.email);
    await page.type('#enq-requirement', entered.requirement);
    await submit();
    dlg = await dialogState();
    {
      const mail = parseMailto(dlg.href);
      const lines = mail.body.split('\r\n');
      const missing = Object.entries(entered)
        .filter(([, value]) => !mail.body.includes(value))
        .map(([key]) => key);
      const crlf = mail.rawBody.includes('%0D%0A') && !/[\r\n]/.test(lines.join('')) && lines.length >= 5;
      const handedOver = dlg.handoffs.length === 1 && dlg.handoffs[0] === dlg.href;
      record(
        'enquiry: a valid request becomes a mailto with every value, CRLF line breaks and no POST',
        dlg.doneShown &&
          !dlg.formShown &&
          dlg.href.startsWith(MAILTO_PREFIX) &&
          mail.fieldCount === 2 &&
          mail.fieldNames.join() === 'subject,body' &&
          missing.length === 0 &&
          crlf &&
          handedOver &&
          sent.length === 0,
        `done panel ${dlg.doneShown}, ${dlg.href.length} characters, ${lines.length} lines, missing: ${missing.join(' ') || 'nothing'}, CRLF ${crlf}, ` +
          `handed to the email app ${handedOver}, requests other than GET: ${sent.length ? sent.join(' ') : 'none'}`,
      );
    }

    // g. a requirement at the field's 1200 character limit
    await page.click('[data-enquiry-done] [data-enquiry-close]');
    await wait(400);
    await openFromHeader();
    const long = 'We need our CPQ rules and price book put right, as it is now too slow to use on a big deal. '.repeat(14).slice(0, 1200);
    await page.evaluate((text) => {
      const area = document.getElementById('enq-requirement');
      area.value = text;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }, long);
    const typedLength = await page.evaluate(() => document.getElementById('enq-requirement').value.length);
    await submit();
    dlg = await dialogState();
    {
      const mail = parseMailto(dlg.href);
      const kept = mail.body.includes(long.slice(0, 200)) && !mail.body.includes(long);
      record(
        'enquiry: a 1200 character requirement keeps the mailto within 1900 characters and says it was shortened',
        typedLength === 1200 && dlg.doneShown && dlg.href.startsWith(MAILTO_PREFIX) && dlg.href.length <= MAILTO_LIMIT && kept && /shortened|only the first part/i.test(dlg.doneText) && sent.length === 0,
        `${typedLength} characters entered, link is ${dlg.href.length} characters, requirement shortened in the link: ${kept}, done text: "${dlg.doneText}"`,
      );
    }

    // h. Escape
    await page.keyboard.press('Escape');
    await untilClosed();
    await wait(200);
    dlg = await dialogState();
    record(
      'enquiry: Escape closes the dialog and returns focus to the control that opened it',
      !dlg.open && !dlg.hasDialog && dlg.focusOnHeaderControl,
      `open ${dlg.open}, has-dialog ${dlg.hasDialog}, focus on ${dlg.focusOnHeaderControl ? 'the header control' : dlg.focus}`,
    );

    // i. an intent link arrives with its service chosen and its note written.
    // The dialog keeps what was typed, so this starts from a fresh page.
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await steadyScroll();
    await guardHandoff();
    await wait(800);
    const INTENT = '#handoff [data-enquiry][data-enquiry-service]';
    const intent = await page.evaluate((sel) => {
      const link = document.querySelector(sel);
      if (!link) return null;
      link.scrollIntoView({ block: 'center' });
      return { service: link.dataset.enquiryService ?? '', note: link.dataset.enquiryNote ?? '', before: document.getElementById('enq-requirement').value };
    }, INTENT);
    if (!intent) {
      record('enquiry: an intent link opens the dialog with its service and note', false, `nothing matches ${INTENT}`);
    } else {
      await wait(700);
      await page.click(INTENT);
      await settleDialog(page);
      dlg = await dialogState();
      const got = await page.evaluate(() => ({ service: document.getElementById('enq-service').value, requirement: document.getElementById('enq-requirement').value }));
      record(
        'enquiry: an intent link opens the dialog with its service and note',
        dlg.open && intent.service.length > 0 && intent.note.length > 0 && intent.before === '' && got.service === intent.service && got.requirement === intent.note && dlg.focus === 'enq-name',
        `service "${got.service}", requirement "${got.requirement}", focus on ${dlg.focus}`,
      );
    }

    // j. a click on the backdrop
    if (!(await dialogState()).open) await openFromHeader();
    const backdrop = await page.evaluate(() => {
      const box = document.querySelector('[data-enquiry-dialog]').getBoundingClientRect();
      const x = box.left >= 16 ? box.left / 2 : window.innerWidth - (window.innerWidth - box.right) / 2;
      const y = box.top + box.height / 2;
      return { x, y, outside: x < box.left - 4 || x > box.right + 4 };
    });
    if (backdrop.outside) await page.mouse.click(backdrop.x, backdrop.y);
    await untilClosed();
    await wait(200);
    dlg = await dialogState();
    record(
      'enquiry: a click on the backdrop closes the dialog',
      backdrop.outside && !dlg.open && !dlg.hasDialog,
      backdrop.outside ? `clicked at ${Math.round(backdrop.x)}, ${Math.round(backdrop.y)}; open ${dlg.open}, has-dialog ${dlg.hasDialog}` : 'no backdrop to click at this width',
    );

    // Regression checks on a fresh page, for defects found in review.
    {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await steadyScroll();
      await guardHandoff();
      await wait(800);

      // The rules are listed in the engine's order whatever route led to the
      // configuration: vacuum lifter first (B-07), then long reach (C-01, R-04).
      await pick('tool', 'vacuum');
      await pick('reach', 'long');
      const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-rules] li[data-kind]')).map((li) => li.firstElementChild.textContent));
      record('rule log follows the engine order, not the order of clicks', order.join(' ') === 'C-01 R-04 B-07', order.join(' '));

      // The chapter rail keeps its navy theme while the white quotation card passes.
      await page.evaluate(() => {
        const box = document.querySelector('#quote .doc').getBoundingClientRect();
        window.scrollTo(0, window.scrollY + box.top + box.height / 2 - window.innerHeight * 0.42);
      });
      await wait(600);
      const rail = await page.evaluate(() => {
        const el = document.querySelector('[data-rail]');
        return { shown: getComputedStyle(el).display !== 'none', light: el.classList.contains('theme-light') };
      });
      record('rail keeps its navy theme beside the quotation card', rail.shown && !rail.light, JSON.stringify(rail));

      // Each opening starts from its own call to action: a service or note the
      // visitor never touched does not travel with the next request.
      const openFrom = async (selector) => {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          el.scrollIntoView({ block: 'center' });
          el.click();
        }, selector);
        await settleDialog(page);
        return page.evaluate(() => ({ service: document.getElementById('enq-service').value, requirement: document.getElementById('enq-requirement').value }));
      };
      const pressEscape = async () => {
        await page.keyboard.press('Escape');
        await untilClosed();
        await wait(150);
      };
      const QUOTE_CTA = '#quote [data-enquiry][data-enquiry-note]';
      const STAFF_CTA = '[data-family-cta]';
      const want = await page.evaluate(
        (a, b) => ({
          quoteService: document.querySelector(a).dataset.enquiryService ?? '',
          quoteNote: document.querySelector(a).dataset.enquiryNote ?? '',
          staffService: document.querySelector(b).dataset.enquiryService ?? '',
          staffNote: document.querySelector(b).dataset.enquiryNote ?? '',
        }),
        QUOTE_CTA,
        STAFF_CTA,
      );
      const first = await openFrom(QUOTE_CTA);
      await pressEscape();
      const second = await openFrom(STAFF_CTA);
      await pressEscape();
      const third = await openFrom(HEADER_CONTROL);
      record(
        'enquiry: each opening starts from its own call to action',
        want.quoteNote.length > 0 &&
          want.staffNote.length > 0 &&
          first.service === want.quoteService &&
          first.requirement === want.quoteNote &&
          second.service === want.staffService &&
          second.requirement === want.staffNote &&
          third.service === '' &&
          third.requirement === '',
        `quote link: "${first.service}" / "${first.requirement}"; staffing button: "${second.service}" / "${second.requirement}"; header: "${third.service}" / "${third.requirement}"`,
      );

      // Errors from an abandoned attempt are gone the next time the dialog opens.
      await submit();
      const flaggedBefore = names(await fieldState(), flagged);
      await pressEscape();
      await openFrom(INTENT);
      const fieldsAfter = await fieldState();
      const statusAfter = (await dialogState()).status;
      record(
        'enquiry: errors from an earlier attempt are gone when it reopens',
        flaggedBefore.length === 4 && names(fieldsAfter, (f) => f.invalid).length === 0 && statusAfter === '',
        `flagged before closing: ${flaggedBefore.join(' ')}; still flagged after reopening: ${names(fieldsAfter, (f) => f.invalid).join(' ') || 'none'}; status "${statusAfter}"`,
      );
      await pressEscape();
    }

    // k. on a phone the dialog is the whole screen
    {
      const { page: phone } = await open(browser, { width: 390, height: 844, mobile: true });
      await phone.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
      const opened = await phone.evaluate(() => {
        const link = Array.from(document.querySelectorAll('[data-enquiry]')).find((el) => el.getClientRects().length > 0);
        if (!link) return '';
        link.scrollIntoView({ block: 'center' });
        link.setAttribute('data-qa-opener', '');
        return link.textContent.replace(/\s+/g, ' ').trim();
      });
      let frozen = 0;
      if (opened) {
        await wait(600);
        await phone.click('[data-qa-opener]');
        frozen = await settleDialog(phone, 900);
      }
      const cover = await phone.evaluate(() => {
        const dialog = document.querySelector('[data-enquiry-dialog]');
        const box = dialog.getBoundingClientRect();
        return { open: dialog.open, left: box.left, top: box.top, right: box.right, bottom: box.bottom, vw: window.innerWidth, vh: window.innerHeight };
      });
      const round = (n) => Math.round(n * 10) / 10;
      record(
        'enquiry: at 390 x 844 the open dialog covers the whole viewport',
        cover.open && cover.left <= 0.5 && cover.top <= 0.5 && cover.right >= cover.vw - 0.5 && cover.bottom >= cover.vh - 0.5,
        `opened from "${opened}", dialog ${round(cover.left)},${round(cover.top)} to ${round(cover.right)},${round(cover.bottom)} in a ${cover.vw} x ${cover.vh} viewport` +
          (frozen ? `; ${frozenNote(frozen)}` : ''),
      );
      await phone.close();
    }

    // ---------------------------------------------------------- 5. accessibility (axe)
    await page.evaluate(() => window.scrollTo(0, 0));
    // Let scroll-driven transitions settle: contrast is judged on steady states.
    await wait(2000);
    await page.addScriptTag({ content: readFileSync(resolve(root, 'node_modules/axe-core/axe.min.js'), 'utf8') });
    const runAxe = (selector) =>
      page.evaluate(
        async (sel, tags) => {
          document.documentElement.classList.add('reveal-fallback');
          const context = sel ? document.querySelector(sel) : document;
          const run = await window.axe.run(context, { runOnly: { type: 'tag', values: tags } });
          return run.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.target?.join(' ') }));
        },
        selector,
        AXE_TAGS,
      );
    const describe = (violations) => violations.map((v) => `${v.id} [${v.impact}] x${v.nodes} ${v.sample}`).join(' | ');
    const axe = await runAxe('');
    record('axe: no WCAG A or AA violations', axe.length === 0, describe(axe));

    const frozen = await openFromHeader();
    dlg = await dialogState();
    const axeDialog = dlg.open ? await runAxe('[data-enquiry-dialog]') : [];
    record(
      'axe: no WCAG A or AA violations in the open enquiry dialog',
      dlg.open && axeDialog.length === 0,
      dlg.open ? [describe(axeDialog), frozenNote(frozen)].filter(Boolean).join('; ') : 'the dialog did not open',
    );
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
        // find any element poking past the right edge (the background lattice is an SVG
        // that is cropped by its own box, so its path is not counted)
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('main *, header *, footer *')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.stage, .site-menu, pre, .lattice')) {
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
      const openers = Array.from(document.querySelectorAll('[data-enquiry]'));
      const dialog = document.querySelector('[data-enquiry-dialog]');
      return {
        hidden,
        h1: document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim(),
        bomRows: Array.from(document.querySelectorAll('[data-bom] tr[data-part]')).filter((r) => !r.hidden).length,
        total: document.querySelector('[data-out="total"]')?.textContent.trim(),
        enquiryLinks: openers.filter((el) => el.tagName === 'A' && (el.getAttribute('href') ?? '').startsWith('mailto:')).length,
        dialogShown: Boolean(dialog) && getComputedStyle(dialog).display !== 'none',
        mailto: Boolean(document.querySelector('a[href^="mailto:"]')),
      };
    });
    record(
      'no JavaScript: content, default example and contact links are present',
      state.hidden === 0 && state.bomRows === 2 && Boolean(state.total) && state.mailto && state.enquiryLinks >= 1 && !state.dialogShown,
      JSON.stringify(state),
    );
    await page.close();
  }

} finally {
  await browser.close();
}

// ------------------------------------------------------------ 9. software-only WebGL
// A browser whose graphics hardware is unusable and which has fallen back to software
// by itself. The page must refuse to draw 3D there and show the posters.
{
  const fallback = await launch({ softwareFallback: true });
  try {
    const { page, problems } = await open(fallback, { softwareWebGL: false });
    await wait(3000);
    const state = await page.evaluate(() => {
      const strict = (type) => {
        try {
          return Boolean(document.createElement('canvas').getContext(type, { failIfMajorPerformanceCaveat: true }));
        } catch {
          return false;
        }
      };
      let renderer = '';
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      } catch {
        renderer = '';
      }
      return {
        noStage: document.documentElement.classList.contains('no-stage'),
        poster: document.querySelector('[data-stage-slot] img')?.getAttribute('src') ?? '',
        canvasReady: Boolean(document.querySelector('.stage-canvas.is-ready')),
        // What the browser itself answers when asked the way the page asks.
        browserGrantsWithoutCaveat: strict('webgl2') || strict('webgl'),
        renderer,
      };
    });
    record('software-only WebGL: posters replace the canvas', state.noStage && state.poster.length > 0 && !state.canvasReady, JSON.stringify(state));
    record('software-only WebGL: no console, page or network errors', problems.length === 0, problems.length ? problems.slice(0, 4).join(' | ') : 'none');
    await page.close();
  } finally {
    await fallback.close();
  }
}

// ------------------------------------------------------------ 10. no WebGL (separate browser without 3D APIs)
{
  const noGl = await launch({ webgl: false });
  try {
    const { page, problems } = await open(noGl, { softwareWebGL: false });
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

// ------------------------------------------------------------ 11. loading metrics (fresh browser, no cache)
{
  const perf = await launch();
  try {
    for (const profile of [
      { name: 'desktop', width: 1440, height: 900, mobile: false, cpu: 1 },
      { name: 'phone, 4x CPU slowdown', width: 390, height: 844, mobile: true, cpu: 4 },
    ]) {
      const page = await perf.newPage();
      await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.mobile ? 2 : 1, isMobile: profile.mobile, hasTouch: profile.mobile });
      // The 3D stage is part of what a visitor's device loads, so it is part of the measurement.
      await allowSoftwareWebGL(page);
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
        return { ...window.__m, fcp: fcp ? fcp.startTime : 0, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, stage: Boolean(document.querySelector('.stage-canvas.is-ready')) };
      });
      const line = `FCP ${Math.round(m.fcp)} ms, LCP ${Math.round(m.lcp)} ms (${m.lcpEl}), CLS ${m.cls.toFixed(3)}, blocking ${Math.round(m.long)} ms, ${requests} requests, ${(bytes / 1024).toFixed(0)} KB transferred, 3D stage ${m.stage ? 'started' : 'not started'}`;
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
