// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * SITE_URL and SITE_BASE let the same source build for the production domain root
 * (the default) or for a sub-path host such as a GitHub Pages project site:
 *
 *   SITE_URL=https://coinshelve.github.io SITE_BASE=/ConPriQuo npm run build
 *
 * SITE_BASE may be written "ConPriQuo", "/ConPriQuo" or "/ConPriQuo/". Any build that is
 * not the production origin at "/" is marked noindex by the layout.
 */
const PRODUCTION = 'https://conpriquo-solutions.in';
const site = process.env.SITE_URL || PRODUCTION;
const base = normaliseBase(process.env.SITE_BASE);
/** Only the production origin at the root is a site search engines should list. */
const isProduction = new URL(site).origin === PRODUCTION && base === '/';

/**
 * Returns the base as "/" or "/segment" with no trailing slash, whichever way it was typed.
 * @param {string | undefined} value
 */
function normaliseBase(value) {
  const raw = (value ?? '').trim();
  // Git Bash on Windows rewrites an argument that starts with a slash into a drive
  // path ("/ConPriQuo" arrives as "C:/Program Files/Git/ConPriQuo"). Building with that
  // would put every asset under a nonsense path, so stop with an explanation instead.
  if (raw.includes(':')) {
    throw new Error(
      `SITE_BASE must be a URL path such as "/ConPriQuo", but it is "${raw}". ` +
        'Git Bash on Windows turns a leading slash into a drive path. ' +
        'Write it without the leading slash (SITE_BASE=ConPriQuo) or set MSYS_NO_PATHCONV=1.',
    );
  }
  const segments = raw.split('/').filter(Boolean);
  return segments.length ? `/${segments.join('/')}` : '/';
}

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  compressHTML: true,
  // A preview copy on another address is noindex, so it gets no sitemap either.
  integrations: isProduction
    ? [
        sitemap({
          // The rendering prototype and any future drafts never reach the sitemap.
          filter: (page) => !/\/(proto|drafts)\b/.test(page),
        }),
      ]
    : [],
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Anek Latin',
      cssVariable: '--font-anek',
      fallbacks: ['Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/anek-latin-latin-wdth-normal.woff2'],
            weight: '100 800',
            style: 'normal',
            stretch: '75% 125%',
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Martian Mono',
      cssVariable: '--font-martian',
      fallbacks: ['Cascadia Mono', 'Consolas', 'Menlo', 'monospace'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/martian-mono-latin-wdth-normal.woff2'],
            weight: '100 800',
            style: 'normal',
            stretch: '75% 112.5%',
          },
        ],
      },
    },
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      // three.js is loaded on demand as its own chunk; the warning threshold reflects that.
      chunkSizeWarningLimit: 700,
    },
  },
});
