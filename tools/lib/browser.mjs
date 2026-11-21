/**
 * Shared by the tools in this folder: find a locally installed Chromium-based browser
 * and launch it headless (nothing is downloaded).
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

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

export function findBrowser() {
  const executablePath = CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) {
    console.error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.');
    process.exit(2);
  }
  return executablePath;
}

/**
 * Launch options:
 *   gpu               use the real graphics hardware (needed for meaningful frame
 *                     timings). The default is a software renderer chosen on purpose,
 *                     so captures match on any machine; Chrome does not report that
 *                     as a performance caveat, and the page's 3D stage starts.
 *   softwareFallback  the graphics hardware is unusable and Chrome has fallen back to
 *                     software by itself. This is the case the page refuses to draw
 *                     3D on, and shows posters instead.
 *   webgl             false simulates a device with no 3D support at all.
 */
export function launch({ gpu = false, webgl = true, softwareFallback = false } = {}) {
  const args = ['--hide-scrollbars', '--force-color-profile=srgb'];
  if (!webgl) args.push('--disable-gpu', '--disable-3d-apis');
  else if (softwareFallback) args.push('--disable-gpu', '--enable-unsafe-swiftshader');
  else if (gpu) args.push('--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11');
  else args.push('--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  return puppeteer.launch({ executablePath: findBrowser(), headless: true, args });
}

/**
 * The site refuses to start its 3D stage where WebGL comes with a major performance
 * caveat (it asks for a context with failIfMajorPerformanceCaveat) and shows posters
 * instead. The default launch above does not trip that, but a headless setup that
 * does would leave the capture tools with nothing to capture, so they lift the
 * refusal for their own page. Call before navigating.
 */
export async function allowSoftwareWebGL(page) {
  await page.evaluateOnNewDocument(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, attributes) {
      const relaxed =
        attributes && attributes.failIfMajorPerformanceCaveat ? { ...attributes, failIfMajorPerformanceCaveat: false } : attributes;
      return original.call(this, type, relaxed);
    };
  });
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads `--name value` from the command line. */
export function option(name, fallback) {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

export const flag = (name) => process.argv.slice(2).includes(`--${name}`);
