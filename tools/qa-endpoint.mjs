#!/usr/bin/env node
/**
 * Checks the enquiry dialog in its "form endpoint" mode, which the ordinary QA run
 * cannot reach because that mode is chosen at build time.
 *
 * The script builds a copy of the site with PUBLIC_FORM_ENDPOINT pointing at a small
 * server it starts itself, serves that copy from the same server, and then sends
 * requests through the real dialog: accepted, refused, slow, never answered, and
 * from an automated form filler. Nothing leaves the machine and dist/ is not touched.
 *
 *   node tools/qa-endpoint.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, wait } from './lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4393;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ENDPOINT = `${ORIGIN}/enquiry`;
const ACCESS_KEY = 'qa-access-key';
const outDir = mkdtempSync(join(tmpdir(), 'conpriquo-endpoint-'));

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// ---------------------------------------------------------------- build
console.log('Building a copy with a form endpoint configured...');
const build = spawnSync(`npx astro build --outDir "${outDir}"`, {
  cwd: root,
  shell: true,
  encoding: 'utf8',
  env: { ...process.env, PUBLIC_FORM_ENDPOINT: ENDPOINT, PUBLIC_FORM_ACCESS_KEY: ACCESS_KEY, SITE_URL: '', SITE_BASE: '' },
});
if (build.status !== 0 || !existsSync(join(outDir, 'index.html'))) {
  console.error(build.stdout, build.stderr);
  console.error('The build failed, so nothing was checked.');
  rmSync(outDir, { recursive: true, force: true });
  process.exit(2);
}

// ---------------------------------------------------------------- server: the site and the endpoint
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
};
/** How the endpoint answers the next request: ok, fail, slow or hang. */
let mode = 'ok';
const received = [];
const server = createServer((req, res) => {
  if (req.url === '/enquiry') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method, type: req.headers['content-type'] ?? '', body });
      const answer = (status) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: status === 200 }));
      };
      if (mode === 'ok') answer(200);
      else if (mode === 'fail') answer(500);
      else if (mode === 'slow') setTimeout(() => answer(200), 1800);
      // 'hang': never answer; the page has to give up by itself
    });
    return;
  }
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  let file = join(outDir, path);
  if (!file.startsWith(outDir)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ready) => server.listen(PORT, '127.0.0.1', ready));

// ---------------------------------------------------------------- the checks
const browser = await launch({ webgl: false });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const fresh = async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; } dialog, dialog::backdrop { animation: none !important; }' });
    await wait(300);
    await page.click('header [data-enquiry]');
    await page.waitForFunction(() => document.querySelector('[data-enquiry-dialog]').open, { timeout: 5000 });
  };
  const fill = async ({ trap = '' } = {}) => {
    await page.select('#enq-service', 'Oracle CPQ implementation');
    await page.type('#enq-name', 'Asha Rao');
    await page.type('#enq-phone', '+91 98765 43210 ext 204');
    await page.type('#enq-email', 'asha.rao@example.com');
    await page.type('#enq-requirement', 'Quotes for configurable machines, with approvals.');
    if (trap) await page.evaluate((value) => (document.getElementById('enq-website').value = value), trap);
  };
  const state = () =>
    page.evaluate(() => {
      const dialog = document.querySelector('[data-enquiry-dialog]');
      const shown = (el) => Boolean(el) && !el.hidden && el.getClientRects().length > 0;
      const submit = dialog.querySelector('[data-enquiry-submit]');
      return {
        open: dialog.open,
        form: shown(dialog.querySelector('[data-enquiry-form]')),
        done: shown(dialog.querySelector('[data-enquiry-done]')),
        title: dialog.querySelector('[data-enquiry-done-title]').textContent.trim(),
        text: dialog.querySelector('[data-enquiry-done-text]').textContent.trim(),
        status: dialog.querySelector('[data-enquiry-status]').textContent.trim(),
        label: submit.textContent.trim(),
        disabled: submit.disabled,
        note: dialog.querySelector('[data-enquiry-note]').textContent.trim(),
        again: shown(dialog.querySelector('[data-enquiry-mailto]')),
        copy: shown(dialog.querySelector('[data-enquiry-copy]')),
        name: document.getElementById('enq-name').value,
      };
    });

  // 1. the dialog presents itself as a form that sends
  await fresh();
  let s = await state();
  record('endpoint mode: the button says "Send request" and the note is about replying', s.label === 'Send request' && /reply to your request/.test(s.note), `"${s.label}" / "${s.note}"`);

  // 2. an accepted request
  mode = 'ok';
  received.length = 0;
  await fill();
  await page.click('[data-enquiry-submit]');
  await page.waitForFunction(() => !document.querySelector('[data-enquiry-done]').hidden, { timeout: 8000 }).catch(() => {});
  s = await state();
  let sent = {};
  try {
    sent = JSON.parse(received[0]?.body ?? '{}');
  } catch {
    sent = {};
  }
  const fields = ['service', 'name', 'phone', 'email', 'requirement', 'page', 'subject', 'access_key'];
  record(
    'accepted: exactly one JSON POST with every field, then "Request sent." and an emptied form',
    received.length === 1 &&
      received[0].method === 'POST' &&
      /application\/json/.test(received[0].type) &&
      fields.every((key) => typeof sent[key] === 'string' && sent[key].length > 0) &&
      sent.access_key === ACCESS_KEY &&
      sent.subject === 'Website inquiry: Oracle CPQ implementation' &&
      s.done &&
      s.title === 'Request sent.' &&
      !s.again &&
      !s.copy &&
      s.name === '',
    `${received.length} request(s), fields: ${Object.keys(sent).join(' ')}; panel "${s.title}"`,
  );

  // 3. a refused request
  await fresh();
  mode = 'fail';
  received.length = 0;
  await fill();
  await page.click('[data-enquiry-submit]');
  await page.waitForFunction(() => document.querySelector('[data-enquiry-status]').textContent.trim().length > 0, { timeout: 8000 }).catch(() => {});
  s = await state();
  record(
    'refused: the form stays, says it could not be sent and gives the email address and phone number',
    received.length === 1 && s.form && !s.done && /could not be sent/.test(s.status) && /admin@conpriquo-solutions\.in/.test(s.status) && /\+91 97391 72525/.test(s.status) && !s.disabled && s.label === 'Send request' && s.name === 'Asha Rao',
    `status "${s.status}"`,
  );

  // 4. while a request is on its way the dialog cannot be closed, so the outcome is seen
  await fresh();
  mode = 'slow';
  received.length = 0;
  await fill();
  await page.click('[data-enquiry-submit]');
  await wait(400);
  const during = await state();
  await page.keyboard.press('Escape');
  await page.mouse.click(8, 400);
  await wait(300);
  const afterEscape = await state();
  await page.click('[data-enquiry-submit]').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-enquiry-done]').hidden, { timeout: 8000 }).catch(() => {});
  s = await state();
  record(
    'in flight: the button reads "Sending" and is disabled, Escape and the backdrop do not close it, and one request is sent',
    during.label === 'Sending' && during.disabled && afterEscape.open && s.done && s.title === 'Request sent.' && received.length === 1,
    `during "${during.label}" disabled ${during.disabled}; open after Escape ${afterEscape.open}; requests ${received.length}; panel "${s.title}"`,
  );

  // 5. an automated form filler gets a confirmation and nothing is sent
  await fresh();
  mode = 'ok';
  received.length = 0;
  await fill({ trap: 'https://spam.example' });
  await page.click('[data-enquiry-submit]');
  await wait(900);
  s = await state();
  record('trap field filled: nothing is sent', received.length === 0 && s.done, `${received.length} request(s); panel "${s.title}"`);

  // 6. an endpoint that never answers
  await fresh();
  mode = 'hang';
  received.length = 0;
  await fill();
  const started = Date.now();
  await page.click('[data-enquiry-submit]');
  await page.waitForFunction(() => document.querySelector('[data-enquiry-status]').textContent.trim().length > 0, { timeout: 25000 }).catch(() => {});
  const waited = Math.round((Date.now() - started) / 1000);
  s = await state();
  record('no answer: the form gives up after about 15 seconds and says so', /could not be sent/.test(s.status) && !s.disabled && waited >= 13 && waited <= 20, `gave up after ${waited} s; status "${s.status}"`);

  record('no script errors in any of the runs', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  // The hanging request is still open, so the server is closed with its connections.
  server.closeAllConnections?.();
  server.close();
  rmSync(outDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
