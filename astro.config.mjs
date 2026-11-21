// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * SITE_URL and SITE_BASE let the same source build for the production domain root
 * (the default) or for a sub-path host such as a GitHub Pages project site:
 *
 *   SITE_URL=https://coinshelve.github.io SITE_BASE=/ConPriQuo npm run build
 */
const site = process.env.SITE_URL || 'https://conpriquo-solutions.in';
const base = process.env.SITE_BASE || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  compressHTML: true,
  integrations: [
    sitemap({
      // The rendering prototype and any future drafts never reach the sitemap.
      filter: (page) => !/\/(proto|drafts)\b/.test(page),
    }),
  ],
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
