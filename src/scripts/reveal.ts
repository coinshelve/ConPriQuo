/**
 * Scroll reveals. Elements marked [data-reveal] ease in once; headlines marked
 * [data-lines] are split into their rendered lines just before they enter the
 * viewport, rise a line at a time, and are then restored to plain text so they keep
 * reflowing normally on resize.
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function splitIntoLines(el: HTMLElement): (() => void) | null {
  // Only plain-text headlines are split; anything with inline markup just fades.
  if (el.children.length > 0) return null;
  const text = el.textContent ?? '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  const tokens = words.map((word) => {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    span.textContent = word;
    return span;
  });
  const measure = document.createDocumentFragment();
  tokens.forEach((token, index) => {
    if (index) measure.append(' ');
    measure.append(token);
  });
  el.replaceChildren(measure);

  const lines: HTMLElement[][] = [];
  let top = Number.NaN;
  for (const token of tokens) {
    const y = token.offsetTop;
    if (Number.isNaN(top) || Math.abs(y - top) > 3) {
      lines.push([]);
      top = y;
    }
    lines[lines.length - 1].push(token);
  }

  const built = document.createDocumentFragment();
  lines.forEach((line, index) => {
    const outer = document.createElement('span');
    outer.className = 'ln';
    outer.style.setProperty('--i', String(index));
    const inner = document.createElement('span');
    inner.textContent = line.map((token) => token.textContent).join(' ');
    outer.append(inner);
    built.append(outer);
    // A real space between line wrappers keeps the text readable to assistive technology.
    if (index < lines.length - 1) built.append(' ');
  });
  el.replaceChildren(built);

  const duration = 900 + lines.length * 85 + 200;
  return () => {
    window.setTimeout(() => {
      el.textContent = text.trim().replace(/\s+/g, ' ');
    }, duration);
  };
}

export function initReveals() {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal], [data-lines]'));
  if (!targets.length) return;
  const revealAll = () => {
    for (const el of targets) el.classList.add('is-in');
  };

  // The inline safety timer in the layout has already shown everything because this
  // script arrived late. Observing now would hide content the visitor is reading.
  if (document.documentElement.classList.contains('reveal-fallback')) {
    revealAll();
    return;
  }

  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealAll();
    return;
  }

  // Printing lays out the whole page at once; nothing may wait for a scroll position.
  window.addEventListener('beforeprint', revealAll);

  const fontsReady = Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((resolve) => window.setTimeout(resolve, 1500)),
  ]);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        if (el.hasAttribute('data-lines')) {
          fontsReady.then(() => {
            // Already shown in full (for example by a print), so there is nothing to stage.
            if (el.classList.contains('is-in')) return;
            const restore = splitIntoLines(el);
            // Two frames so the starting transform is committed before the class flips.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                el.classList.add('is-in');
                restore?.();
              }),
            );
          });
        } else {
          el.classList.add('is-in');
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
  );

  for (const el of targets) observer.observe(el);
}
