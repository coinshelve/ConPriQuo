#!/usr/bin/env node
/**
 * Derives the site icons from the original logo file, without redrawing anything.
 *
 * The full lockup is unreadable at favicon sizes, so the icons use the logo's own
 * mark: the hexagonal "C" and the magenta bar that runs out of it. Those two shapes are
 * lifted pixel for pixel from the original PNG (the neighbouring letters are left
 * behind), centred on a square canvas and downsampled. No shape, colour or proportion
 * is altered.
 *
 *   node tools/brand-assets.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src/assets/brand/conpriquo-solutions-logo.png');
const outDir = resolve(root, 'public');
// The mark is navy and magenta, so wherever an icon needs a solid ground it is white,
// as in the site header.
const WHITE = { r: 0xff, g: 0xff, b: 0xff, alpha: 1 };

const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const isNavy = (r, g, b) => r < 70 && g < 70 && b < 120;
const isMagenta = (r, g, b) => r > 200 && g < 100 && b > 80 && b < 190;

// Bounds measured on the original 1473 x 487 artwork: the hexagon occupies x 1..400,
// the bar x 213..511 and y 167..221. The first wordmark letter begins at x 404.
const HEX_MAX_X = 401;
const BAR = { minX: 205, maxX: 516, minY: 160, maxY: 228 };

const keep = Buffer.alloc(width * height * 4, 0);
let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a === 0) continue;
    const inHex = x <= HEX_MAX_X && isNavy(r, g, b);
    const inBar = x >= BAR.minX && x <= BAR.maxX && y >= BAR.minY && y <= BAR.maxY && isMagenta(r, g, b);
    if (!inHex && !inBar) continue;
    const o = (y * width + x) * 4;
    keep[o] = r;
    keep[o + 1] = g;
    keep[o + 2] = b;
    keep[o + 3] = a;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}

const markWidth = maxX - minX + 1;
const markHeight = maxY - minY + 1;
const mark = await sharp(keep, { raw: { width, height, channels: 4 } })
  .extract({ left: minX, top: minY, width: markWidth, height: markHeight })
  .png()
  .toBuffer();

/** The mark centred on a square canvas with the given margin (fraction of the side). */
async function square(size, margin, background) {
  const side = Math.round(markWidth / (1 - margin * 2));
  const canvas = sharp({
    create: { width: side, height: side, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: mark, left: Math.round((side - markWidth) / 2), top: Math.round((side - markHeight) / 2) }]);
  const full = await canvas.png().toBuffer();
  return sharp(full).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
}

/** Minimal ICO container holding PNG-encoded images. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, buffer } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.buffer)]);
}

mkdirSync(resolve(outDir, 'icons'), { recursive: true });

const write = (path, buffer) => {
  writeFileSync(resolve(outDir, path), buffer);
  console.log('wrote', `public/${path}`, `${buffer.length} bytes`);
};

// Small sizes get a tighter margin so the mark stays legible in a browser tab.
write('favicon.ico', ico([
  { size: 16, buffer: await square(16, 0.02) },
  { size: 32, buffer: await square(32, 0.03) },
  { size: 48, buffer: await square(48, 0.04) },
]));
write('icons/icon-192.png', await square(192, 0.1));
write('icons/icon-512.png', await square(512, 0.1));
write('icons/icon-maskable-512.png', await square(512, 0.2, WHITE));
write('icons/apple-touch-icon.png', await square(180, 0.14, WHITE));

const manifest = {
  name: 'ConPriQuo Solutions',
  short_name: 'ConPriQuo',
  description: 'Oracle CPQ, Oracle CX and Salesforce consulting, and specialized IT staffing.',
  start_url: '.',
  scope: '.',
  display: 'browser',
  // the page ground is the logo's navy; the browser chrome matches the white header
  background_color: '#11123c',
  theme_color: '#ffffff',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
write('site.webmanifest', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(`mark lifted from the logo: ${markWidth} x ${markHeight} px at (${minX}, ${minY})`);
