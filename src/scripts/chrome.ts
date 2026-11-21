/** Header state, the small-screen menu, and the chapter rail. */
export function initChrome() {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (toggle && menu) {
    const setOpen = (open: boolean, returnFocus = false) => {
      toggle.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
      if (!open && returnFocus) toggle.focus();
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('a')) setOpen(false);
    });
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
    // The toggle and the panel both live in the header, so "outside the header" means
    // the visitor has moved on and the panel should not stay open over the page.
    const outsideHeader = (node: EventTarget | null) =>
      node instanceof Node && !(header ?? menu).contains(node) && !toggle.contains(node);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      // Focus goes back to the button only when closing would otherwise strand it
      // inside the hidden panel. Elsewhere on the page it stays where the visitor put it.
      setOpen(false, menu.contains(document.activeElement));
    });
    (header ?? menu).addEventListener('focusout', (event) => {
      // A null relatedTarget is the window losing focus, which should not close anything.
      if (isOpen() && outsideHeader(event.relatedTarget)) setOpen(false);
    });
    document.addEventListener('pointerdown', (event) => {
      if (isOpen() && outsideHeader(event.target)) setOpen(false);
    });
    // Leaving the small-screen layout closes the panel so it cannot be stranded open.
    window.matchMedia('(min-width: 68.01rem)').addEventListener('change', (event) => {
      if (event.matches) setOpen(false);
    });
  }

  initRail();
}

/** Highlights the chapter in view on the rail and in the small-screen menu. */
function initRail() {
  const rail = document.querySelector<HTMLElement>('[data-rail]');
  // The rail is hidden on small screens, where the menu carries the same chapter links,
  // so both sets are marked from one reading of the scroll position.
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('[data-rail] a[href^="#"], [data-menu] a[data-menu-link][href^="#"]'),
  );
  if (!links.length) return;
  const ids = Array.from(new Set(links.map((link) => link.hash.slice(1))));
  const targets = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
  if (!targets.length) return;
  const lightSections = Array.from(document.querySelectorAll<HTMLElement>('main .theme-light, footer .theme-light'));

  let current = '';
  const update = () => {
    const line = window.innerHeight * 0.42;
    let active = '';
    for (const target of targets) {
      if (target.getBoundingClientRect().top <= line) active = target.id;
    }
    if (rail) {
      rail.classList.toggle('is-visible', Boolean(active));
      // The page is navy by default; over a light section the rail takes the light theme.
      const middle = window.innerHeight / 2;
      let overLight = false;
      for (const light of lightSections) {
        const box = light.getBoundingClientRect();
        if (box.top < middle && box.bottom > middle) overLight = true;
      }
      rail.classList.toggle('theme-light', overLight);
    }
    if (active === current) return;
    current = active;
    for (const link of links) {
      const on = link.hash.slice(1) === active;
      link.classList.toggle('is-current', on);
      if (on) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}
