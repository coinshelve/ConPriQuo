#!/usr/bin/env node
/**
 * Renders the social preview image (1200 x 630) with the site's own fonts, the original
 * logo file and a poster of the 3D model, by laying it out as HTML and capturing it.
 *
 *   node tools/og-image.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = (path) => readFileSync(resolve(root, path)).toString('base64');

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
    background: #f4f1ea;
    color: #11123c;
    font-family: 'Anek Latin', sans-serif;
  }
  .logo { position: absolute; left: 64px; top: 52px; width: 262px; }
  .model { position: absolute; right: -150px; top: -72px; width: 760px; }
  .text { position: absolute; left: 64px; bottom: 112px; width: 640px; }
  h1 {
    font-size: 62px;
    font-weight: 600;
    font-stretch: 112%;
    line-height: 0.98;
    letter-spacing: -0.03em;
  }
  h1 span { display: block; margin-top: 8px; font-weight: 380; color: rgba(17, 18, 60, 0.76); }
  .foot {
    position: absolute; left: 64px; bottom: 52px;
    display: flex; align-items: center; gap: 16px;
    font-family: 'Martian Mono', monospace;
    font-size: 15px; font-stretch: 96%; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(17, 18, 60, 0.7);
  }
  .foot i { width: 42px; height: 10px; border-radius: 10px; background: #ed107e; }
</style>
</head>
<body>
  <img class="model" src="data:image/webp;base64,${b64('src/assets/posters/unit-0.webp')}" alt="">
  <img class="logo" src="data:image/png;base64,${b64('src/assets/brand/conpriquo-solutions-logo.png')}" alt="">
  <div class="text">
    <h1>Oracle CPQ, Oracle CX and Salesforce consulting.<span>By the project, or by the specialist.</span></h1>
  </div>
  <p class="foot"><i></i>conpriquo-solutions.in</p>
</body>
</html>`;

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  const outDir = resolve(root, 'public/og');
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, 'conpriquo-solutions.png');
  const optimised = await sharp(png).png({ compressionLevel: 9, palette: false }).toBuffer();
  writeFileSync(out, optimised);
  console.log('wrote public/og/conpriquo-solutions.png', `${optimised.length} bytes`);
} finally {
  await browser.close();
}
