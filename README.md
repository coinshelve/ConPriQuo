# ConPriQuo Solutions website

Homepage for [ConPriQuo Solutions](https://conpriquo-solutions.in/): Oracle CPQ, Oracle CX and
Salesforce consulting, and specialized IT staffing.

This phase contains the homepage only. The header and footer show the planned page names as plain
text; they become links when those pages are built.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Site | [Astro](https://astro.build/) 7, static output | All content is server-rendered HTML; almost no JavaScript on the critical path |
| 3D | [three.js](https://threejs.org/) (WebGL 2), loaded on demand | One lazy chunk, only on devices with graphics hardware that can draw it |
| Type | Anek Latin and Martian Mono, self-hosted variable fonts (SIL OFL) | `src/assets/fonts/`, licences alongside |
| Styling | Hand-written CSS with design tokens and two colour themes | `src/styles/global.css` |

There is no framework runtime, no animation library and no CSS framework.

## Commands

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
npm run check      # Astro and TypeScript diagnostics
npm test           # unit tests for the configure-price-quote engine
npm run qa         # 51 automated checks against a running preview (see tools/qa.mjs)
npm run qa:endpoint  # the enquiry form posting to a form endpoint, against a local stand-in
```

Node 22.23 or newer is required.

## How the page is put together

```
src/
  pages/index.astro        page assembly, title, description, JSON-LD
  pages/robots.txt.ts      robots.txt with the sitemap for the configured site URL
  layouts/Base.astro       document head, fonts, social metadata
  data/site.ts             company facts, the planned page names and the enquiry services (single source)
  components/
    Header.astro           logo, planned pages (text), enquiry call to action, small-screen menu
    Rail.astro             in-page chapter navigation
    Story.astro            opening + the worked example: Configure, Price, Quote, Hand off
    Practices.astro        Oracle CPQ, Oracle CX and Salesforce on one lifecycle line
    Engagements.astro      published Oracle CPQ engagements
    Delivery.astro         how a project runs
    Staffing.astro         skill families and the shortlist process
    Lattice.astro          the logo's hexagon as a still background for navy sections
    Closing.astro          the last section: discuss a project, or request specialists
    Enquiry.astro          the enquiry form, as a modal dialog
    Footer.astro
  scripts/
    cpq/engine.ts          rules, bill of materials, pricing, approvals (pure functions, tested)
    workbench.ts           binds the worked example's HTML to the engine
    stage.ts               3D stage: scroll direction for all scenes
    scene/                 renderer rig, the machine, the quote sheet, the staffing scene, labels
    fallback.ts            static posters when the 3D stage cannot run
    enquiry.ts             enquiry dialog: opening, validation and delivery
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

### The enquiry dialog

Every call to action on the page opens one form, a modal dialog: `src/components/Enquiry.astro`
holds the markup and `src/scripts/enquiry.ts` the behaviour. `Closing.astro`, the last section of
the page, offers the two ways in (a project, or specialists) and the footer below it carries the
direct email and phone lines.

Any element with a `data-enquiry` attribute opens the dialog. Each one is an ordinary
`mailto:` link, so it still works when the script does not run. Two optional attributes prepare
the form: `data-enquiry-service` selects a service, and `data-enquiry-note` fills the requirement
field when it is empty. The form asks for a service, a name, a phone number and a business email;
the requirement is optional. Errors are shown beside each field and announced, and focus returns
to the element that opened the dialog when it closes. At narrow widths the dialog fills the
screen.

How a request is delivered is decided at build time by `PUBLIC_FORM_ENDPOINT`:

| `PUBLIC_FORM_ENDPOINT` | What happens on submit |
| --- | --- |
| Set to a URL | The request is sent to that URL as a JSON `POST` with the fields `service`, `name`, `phone`, `email`, `requirement`, `page` and `subject`. The dialog reports success only when the endpoint answers with a success status; otherwise it shows the email address and phone number. |
| Not set | There is no server to receive anything, so the request is handed to the visitor's own email app as a ready-to-send message (a `mailto:` link). The page cannot know whether that app opened, so the dialog does not say the request was sent: it says a message should be open, and offers to open it again, copy the details, or call. Nothing is transmitted or stored by the page. |

```sh
PUBLIC_FORM_ENDPOINT=https://forms.example.com/your-form npm run build
```

Some form services identify the form by a public key sent with each request instead of by the
URL. Set `PUBLIC_FORM_ACCESS_KEY` as well and it is sent as `access_key`. For the GitHub Pages
deployment both values are read from repository variables of the same names (see Deployment).
`npm run qa:endpoint` checks this mode: it builds a copy with a stand-in endpoint on the local
machine and sends accepted, refused, slow and unanswered requests through the real dialog.

The email link is kept to 1900 characters, because some mail handlers cut off longer ones. A very
long requirement is shortened in the link and the dialog tells the visitor so.

### Colour themes

The page has two themes, both defined as semantic tokens in `src/styles/global.css`: ground
colours (`--ground`, `--ground-2`, `--raise`), text (`--ink`, `--ink-2`, `--ink-3`), hairlines
(`--hair`, `--hair-strong`) and `--wash`. Navy is the default and applies from `:root`. Wrapping
any region in `.theme-light` switches the same tokens to dark text on a cool white, and
`.theme-dark` switches a region back to navy inside a light one (the enquiry dialog is light with
a navy side panel). Component styles are written against these tokens wherever a colour depends
on the surface behind it, which is what lets the same component sit in either theme. The brand
constants (`--navy`, `--magenta` and the other logo colours) sit above the themes and do not
change.

### The 3D stage and its fallback

The stage asks the browser for a WebGL context with `failIfMajorPerformanceCaveat`, so it starts
only where real graphics hardware is available. A browser that could only draw the scene with a
software renderer is refused, as is one with no WebGL at all, and `src/scripts/fallback.ts` shows
static posters in place of the canvas (the page gets the class `no-stage`). The posters are
captures of the real scene in each settled state, made by `tools/posters.mjs`. The same posters
are in the HTML for visitors without JavaScript.

### Progressive enhancement

| Situation | Result |
| --- | --- |
| No JavaScript | Full content, the default worked example, static posters, and every call to action as a direct email link |
| No WebGL, software-only WebGL, or WebGL fails to start | Everything interactive still works; static posters replace the canvas |
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
  anything in `src/scripts/scene/`. It writes to `src/assets/posters`; pass `--out <dir>` to
  write somewhere else, for example to compare before replacing the real ones.
- `tools/qa.mjs` exercises a running build end to end: the configurator's rules, pricing and
  approvals, the enquiry dialog (opening, validation, the email handoff, closing and focus), axe
  accessibility rules for the page and for the open dialog, overflow at eight widths, reduced
  motion, no JavaScript, software-only WebGL, no WebGL, and loading metrics. Run
  `npm run build && npm run preview` first.
- `tools/qa-endpoint.mjs` checks the enquiry dialog's form-endpoint mode (see above).
- `tools/tour.mjs` captures one screenshot per chapter, plus the enquiry dialog, at desktop,
  tablet and phone sizes.
- `tools/shot.mjs` takes exact-size screenshots for visual QA, for example:

  ```sh
  node tools/shot.mjs --url http://127.0.0.1:4321/ --out shots/phone --width 390 --height 844 --dpr 2 --mobile --scroll 0,1200,2400
  ```

`shot`, `tour`, `posters`, `og-image` and `qa` share `tools/lib/browser.mjs`. It finds a Chrome or
Edge already installed on the machine (`CHROME_PATH` overrides the lookup) and launches it
headless. By default it selects a software renderer on purpose, so captures match on any machine;
Chrome does not treat that as a performance caveat, so the 3D stage starts. Two other launch modes
exist for testing the fallbacks: `softwareFallback` (graphics hardware unusable, which is the case
the page refuses and answers with posters) and `webgl: false` (no 3D support at all). The QA run
covers both. The helper also reads the command-line options the tools share.

These are development tools and are not needed to build the site.

## Deployment

`npm run build` produces a fully static site in `dist/` that can be served by any static host.

The canonical URL and the sitemap use `https://conpriquo-solutions.in` by default. To build for
another origin or for a sub-path (for example a GitHub Pages project site), set two variables.
`SITE_BASE` may be written `ConPriQuo`, `/ConPriQuo` or `/ConPriQuo/`.

```sh
SITE_URL=https://coinshelve.github.io SITE_BASE=ConPriQuo npm run build
```

In PowerShell:

```powershell
$env:SITE_URL = 'https://coinshelve.github.io'; $env:SITE_BASE = 'ConPriQuo'; npm run build
```

Git Bash on Windows rewrites a value that starts with a slash into a drive path; the build stops
with an explanation if that happens, so leave the leading slash off there.

A build for any address other than the production one is a preview: it is marked
`noindex, nofollow`, its canonical URL and structured data still name the production site, it has
no sitemap and its `robots.txt` asks crawlers to stay out, so it cannot compete with the real site
in search.

Enquiries are handed to the visitor's email app unless `PUBLIC_FORM_ENDPOINT` is set for the build
(see "The enquiry dialog").

### GitHub Pages

`.github/workflows/deploy-pages.yml` runs on every push to `main`: it installs, type-checks, runs
the unit tests, builds, and commits the result on top of the `gh-pages` branch, which GitHub Pages
serves. The branch is never force-pushed.

Until a custom domain is attached, the deployment is a preview at
`https://coinshelve.github.io/ConPriQuo/` (noindex, canonical URL on the production domain).

Three optional repository variables control the build (Settings > Secrets and variables >
Actions > Variables):

| Variable | Effect |
| --- | --- |
| `CUSTOM_DOMAIN` | For example `conpriquo-solutions.in`. The site is built for that domain at the root, a `CNAME` file is published, and the site becomes the indexable production site. Set it only after the domain's DNS points at GitHub Pages, otherwise the preview address redirects to a domain that still serves something else. |
| `PUBLIC_FORM_ENDPOINT` | URL that receives enquiries as a JSON `POST`. |
| `PUBLIC_FORM_ACCESS_KEY` | Public key for form services that ask for one. |

### The production domain

`conpriquo-solutions.in` is not served from this repository. As of November 2026 it is a WordPress
site behind Cloudflare. Putting this homepage on that domain is a hosting decision with two routes:
point the domain's DNS at GitHub Pages and set `CUSTOM_DOMAIN` (the whole domain is then this
static site), or upload the contents of `dist/` from a production build to the current host.

## Content rules

`src/data/site.ts` holds the company facts. Everything on the page restates what ConPriQuo has
published itself. Do not add certifications, partner tiers, client logos, metrics or testimonials
unless the company can document them.

House style for visible copy:

- No em dashes. `npm run qa` fails if one appears.
- American spelling, matching the company's own material (customization, fulfillment, prioritize).
- Headings say something specific. No "What We Do", "Why Choose Us" or similar.
- Oracle and Salesforce are named descriptively ("Oracle CPQ consulting"), never as a claim of
  partnership or certification.
