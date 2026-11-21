/**
 * Static stand-in for the 3D stage, used only when WebGL is unavailable or fails to
 * start. Each poster is a capture of the real scene in one of its settled states
 * (see tools/posters.mjs), swapped as the visitor moves between chapters, so the
 * page tells the same story without a canvas.
 */
import unit0 from '../assets/posters/unit-0.webp?url';
import unit1 from '../assets/posters/unit-1.webp?url';
import unit2 from '../assets/posters/unit-2.webp?url';
import unit3 from '../assets/posters/unit-3.webp?url';
import unit4 from '../assets/posters/unit-4.webp?url';
import team0 from '../assets/posters/team-0.webp?url';
import team1 from '../assets/posters/team-1.webp?url';
import team2 from '../assets/posters/team-2.webp?url';
import team3 from '../assets/posters/team-3.webp?url';

const UNIT = [unit0, unit1, unit2, unit3, unit4];
const TEAM = [team0, team1, team2, team3];
const PHASE_NAMES = ['Align', 'Source', 'Screen', 'Coordinate'];

function poster(slot: HTMLElement, src: string) {
  let img = slot.querySelector<HTMLImageElement>('img.stage-poster');
  if (!img) {
    img = document.createElement('img');
    img.className = 'stage-poster';
    img.alt = '';
    img.decoding = 'async';
    slot.append(img);
  }
  if (img.getAttribute('src') !== src) img.src = src;
}

export function initFallback() {
  document.documentElement.classList.add('no-stage');
  const unitSlot = document.querySelector<HTMLElement>('[data-stage-slot]');
  const teamSlot = document.querySelector<HTMLElement>('[data-team-slot]');
  const steps = Array.from(document.querySelectorAll<HTMLElement>('[data-step]'));
  const phases = Array.from(document.querySelectorAll<HTMLElement>('[data-phase]'));
  const caption = document.querySelector<HTMLElement>('[data-team-caption]');
  const desktop = window.matchMedia('(min-width: 64rem)');

  const update = () => {
    const vh = window.innerHeight;
    if (unitSlot) {
      const focus = vh * (desktop.matches ? 0.5 : 0.62);
      let index = 0;
      steps.forEach((step, i) => {
        if (step.getBoundingClientRect().top <= focus) index = i + 1;
      });
      poster(unitSlot, UNIT[index]);
    }
    if (teamSlot) {
      const focus = vh * (desktop.matches ? 0.56 : 0.7);
      let index = 0;
      phases.forEach((phase, i) => {
        if (phase.getBoundingClientRect().top <= focus) index = i;
      });
      poster(teamSlot, TEAM[index]);
      phases.forEach((phase, i) => phase.classList.toggle('is-current', i === index));
      if (caption) caption.textContent = PHASE_NAMES[index];
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
