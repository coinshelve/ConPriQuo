#!/usr/bin/env node
/**
 * Renders the social preview image (1200 x 630) with the site's own fonts, the original
 * logo file and a poster of the 3D model, by laying it out as HTML and capturing it.
 * The layout mirrors the page: the logo on a white band, the tagline on the logo's navy.
 *
 *   node tools/og-image.mjs            writes public/og/conpriquo-solutions.png
 *   node tools/og-image.mjs --out <file>
 *
 * Run tools/posters.mjs first if the 3D scene has changed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launch, option } from './lib/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = (path) => readFileSync(resolve(root, path)).toString('base64');
const out = resolve(option('out', resolve(root, 'public/og/conpriquo-solutions.png')));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Anek Latin';
    src: url(data:font/woff2;base64,${b64('src/assets/fonts/anek-latin-latin-wdth-normal.woff2')}) format('woff2');
    font-weight: 100 800;
    font-stretch: 75% 125%;
  }
  @font-face {
    font-family: 'Martian Mono';
    src: url(data:font/woff2;base64,${b64('src/assets/fonts/martian-mono-latin-wdth-normal.woff2')}) format('woff2');
    font-weight: 100 800;
    font-stretch: 75% 112.5%;
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; }
  body {
    position: relative;
    overflow: hidden;
    background: #11123c;
    color: #f3f5fb;
    font-family: 'Anek Latin', sans-serif;
  }
  /* The logo is used exactly as supplied, so it sits on white, as in the site header. */
  .band {
    position: absolute; inset: 0 0 auto 0; height: 118px;
    background: #ffffff;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 64px;
  }
  .logo { width: 248px; display: block; }
  .site {
    font-family: 'Martian Mono', monospace;
    font-size: 16px; font-stretch: 96%; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(17, 18, 60, 0.72);
  }
  .model { position: absolute; right: -78px; top: 44px; width: 600px; }
  .text { position: absolute; left: 64px; top: 214px; }
  .services {
    display: flex; gap: 26px;
    font-family: 'Martian Mono', monospace;
    font-size: 16px; font-weight: 500; font-stretch: 96%; letter-spacing: 0.09em; text-transform: uppercase;
    color: rgba(243, 245, 251, 0.82);
  }
  .services span { display: inline-flex; align-items: center; gap: 10px; }
  .services span::before { content: ''; width: 11px; height: 11px; border-radius: 50%; background: var(--dot); }
  h1 {
    margin-top: 34px;
    font-size: 70px;
    font-weight: 660;
    font-stretch: 112%;
    line-height: 1;
    letter-spacing: -0.035em;
    white-space: nowrap;
  }
  h1 span { display: block; margin-top: 6px; font-weight: 360; color: rgba(243, 245, 251, 0.8); }
  .lead {
    margin-top: 30px; width: 600px;
    font-size: 23px; line-height: 1.42; color: rgba(243, 245, 251, 0.8);
  }
</style>
</head>
<body>
  <img class="model" src="data:image/webp;base64,${b64('src/assets/posters/unit-0.webp')}" alt="">
  <div class="band">
    <img class="logo" src="data:image/png;base64,${b64('src/assets/brand/conpriquo-solutions-logo.png')}" alt="">
    <p class="site">conpriquo-solutions.in</p>
  </div>
  <div class="text">
    <p class="services">
      <span style="--dot:#ed107e">Oracle CPQ</span>
      <span style="--dot:#f7941d">Oracle CX</span>
      <span style="--dot:#00aeef">Salesforce</span>
      <span style="--dot:#f3f5fb">IT Staffing</span>
    </p>
    <h1>Get the quote right.<span>Get the right people.</span></h1>
    <p class="lead">Oracle CPQ, Oracle CX and Salesforce consulting, and the specialists your team is missing.</p>
  </div>
</body>
</html>`;

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  mkdirSync(dirname(out), { recursive: true });
  const optimised = await sharp(png).png({ compressionLevel: 9, palette: false }).toBuffer();
  writeFileSync(out, optimised);
  console.log('wrote', out, `${optimised.length} bytes`);
} finally {
  await browser.close();
}
