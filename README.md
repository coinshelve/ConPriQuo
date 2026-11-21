# ConPriQuo Solutions website

Homepage for [ConPriQuo Solutions](https://conpriquo-solutions.in/): Oracle CPQ, Oracle CX and
Salesforce consulting, and specialized IT staffing.

This phase contains the homepage only. The header and footer show the planned page names as plain
text; they become links when those pages are built.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Site | [Astro](https://astro.build/) 7, static output | All content is server-rendered HTML; almost no JavaScript on the critical path |
| 3D | [three.js](https://threejs.org/) (WebGL 2), loaded on demand | One lazy chunk, only on devices that can draw it |
| Type | Anek Latin and Martian Mono, self-hosted variable fonts (SIL OFL) | `src/assets/fonts/`, licences alongside |
| Styling | Hand-written CSS with design tokens | `src/styles/global.css` |

There is no framework runtime, no animation library and no CSS framework.

## Commands

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
npm run check      # Astro and TypeScript diagnostics
npm test           # unit tests for the configure-price-quote engine
```

Node 22.23 or newer is required.

## How the page is put together

```
src/
  pages/index.astro        page assembly, title, description, JSON-LD
  pages/robots.txt.ts      robots.txt with the sitemap for the configured site URL
  layouts/Base.astro       document head, fonts, social metadata
  data/site.ts             company facts and the planned page names (single source)
  components/
    Header.astro           logo, planned pages (text), brief call to action, small-screen menu
    Rail.astro             in-page chapter navigation
    Story.astro            opening + the worked example: Configure, Price, Quote, Hand off
    Practices.astro        Oracle CPQ, Oracle CX and Salesforce on one lifecycle line
    Engagements.astro      published Oracle CPQ engagements
    Staffing.astro         skill families and the shortlist process
    Delivery.astro         how a project runs
    Brief.astro            the enquiry composer
    Footer.astro
  scripts/
    cpq/engine.ts          rules, bill of materials, pricing, approvals (pure functions, tested)
    workbench.ts           binds the worked example's HTML to the engine
    stage.ts               3D stage: scroll direction for all scenes
    scene/                 renderer rig, the machine, the quote sheet, the staffing scene, labels
    fallback.ts            static posters when WebGL is unavailable
    brief.ts               brief composer (mailto and clipboard, no network)
    reveal.ts, chrome.ts   scroll reveals, header, menu, rail
tools/                     asset and QA scripts (see below)
tests/                     engine unit tests
```

### The worked example

The centre of the page is a small, real configure-price-quote flow for a fictional machine, the HX-6.
`src/scripts/cpq/engine.ts` evaluates constraint and recommendation rules, an attribute-driven bill
of materials, volume tiers, a negotiated discount and discount-based approval routing. The page is
rendered on the server for the default configuration, so the content is complete without
JavaScript; scripting then makes it respond. The 3D scene only illustrates state that already
exists as HTML.

The HX-6, its part numbers and its figures are invented. The demo regions are marked
`data-nosnippet` so search engines do not present them as facts about the company.

### The enquiry mechanism

This is a static site with no server. The brief composer assembles a plain-text brief in the
browser and hands it to the visitor's own email app through a `mailto:` link, or copies it to the
clipboard. Nothing is transmitted or stored by the page. To use a form endpoint instead, replace
the handoff in `src/scripts/brief.ts`.

### Progressive enhancement

| Situation | Result |
| --- | --- |
| No JavaScript | Full content, the default worked example, static posters, direct email and phone links |
| No WebGL, or WebGL fails to start | Everything interactive still works; static posters replace the canvas |
| `prefers-reduced-motion: reduce` | No scroll reveals or idle motion; the 3D scene jumps between settled states |
| Small screens, Save-Data, four or fewer CPU cores | Lower pixel ratio and shadow resolution |

## Brand assets

The logo is used exactly as supplied: `src/assets/brand/conpriquo-solutions-logo.png` is the
original file, resized only by the build and kept as lossless PNG so its four colours stay exact.

```sh
npm run assets     # favicon, app icons, web manifest, social preview image
npm run posters    # static posters of the 3D scenes (needs the site running)
```

- `tools/brand-assets.mjs` builds the favicon and app icons from the logo's own mark (the
  hexagonal C and the magenta bar), lifted pixel for pixel from the original file.
- `tools/og-image.mjs` renders the 1200 x 630 social preview.
- `tools/posters.mjs` captures the real 3D scene in each settled state. Re-run it after changing
  anything in `src/scripts/scene/`.
- `tools/shot.mjs` takes exact-size screenshots for visual QA, for example:

  ```sh
  node tools/shot.mjs --url http://127.0.0.1:4321/ --out shots/phone --width 390 --height 844 --dpr 2 --mobile --scroll 0,1200,2400
  ```

The tools use a Chrome or Edge already installed on the machine (`CHROME_PATH` overrides the
lookup). They are development tools and are not needed to build the site.

## Deployment

`npm run build` produces a fully static site in `dist/` that can be served by any static host.

The canonical URL and the sitemap use `https://conpriquo-solutions.in` by default. To build for
another origin or for a sub-path (for example a GitHub Pages project site), set two variables:

```sh
SITE_URL=https://coinshelve.github.io SITE_BASE=/ConPriQuo npm run build
```

No hosting or deployment pipeline is configured in this repository yet.

## Content rules

`src/data/site.ts` holds the company facts. Everything on the page restates what ConPriQuo has
published itself. Do not add certifications, partner tiers, client logos, metrics or testimonials
unless the company can document them.
