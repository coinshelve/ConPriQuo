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
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setOpen(false, true);
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
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-rail] a[href^="#"]'));
  if (!links.length) return;
  const rail = document.querySelector<HTMLElement>('[data-rail]')!;
  const targets = links
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter((el): el is HTMLElement => Boolean(el));
  if (!targets.length) return;
  const darkSections = Array.from(document.querySelectorAll<HTMLElement>('.on-navy'));

  let current = '';
  const update = () => {
    const line = window.innerHeight * 0.42;
    let active = '';
    for (const target of targets) {
      if (target.getBoundingClientRect().top <= line) active = target.id;
    }
    rail.classList.toggle('is-visible', Boolean(active));
    // Over the navy section the rail switches to light marks.
    const middle = window.innerHeight / 2;
    let overNavy = false;
    for (const dark of darkSections) {
      const box = dark.getBoundingClientRect();
      if (box.top < middle + 130 && box.bottom > middle - 130) overNavy = true;
    }
    rail.classList.toggle('is-on-navy', overNavy);
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
