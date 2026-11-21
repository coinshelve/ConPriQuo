/**
 * The 3D stage. Loaded on demand after first paint, and only where WebGL is available.
 *
 * One renderer serves two scenes. In the worked example, a single machine is followed
 * from assembly through configuration, an exploded bill of materials, the quote sheet
 * and the handoff to CRM and ERP. In the staffing chapter the logo's dots become
 * people moving through the shortlist process. The canvas only illustrates state that
 * already exists as HTML on the page.
 */
import { Group, Vector3 } from 'three';
import type { Evaluation } from './cpq/engine';
import { money } from './cpq/engine';
import { LabelLayer } from './scene/labels';
import type { Label } from './scene/labels';
import { createMaterials } from './scene/palette';
import { Quote } from './scene/quote';
import { Rig } from './scene/rig';
import type { CameraPose } from './scene/rig';
import { Spring, clamp01, easeInOut, lerp, span } from './scene/spring';
import { Team } from './scene/team';
import type { Family } from './scene/team';
import { Unit } from './scene/unit';
import type { Workbench } from './workbench';

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Camera at each chapter of the worked example: opening, configure, price, quote, hand off. */
const POSES: CameraPose[] = [
  { tx: 1.45, ty: 1.0, tz: 0, fitH: 7.6, fitW: 10.4, az: deg(40), el: deg(29) },
  { tx: 2.1, ty: 0.9, tz: 0, fitH: 9.4, fitW: 13.4, az: deg(33), el: deg(34) },
  { tx: 1.6, ty: 2.6, tz: 0, fitH: 11.4, fitW: 14.2, az: deg(42), el: deg(27) },
  { tx: 0, ty: 0.4, tz: 0.1, fitH: 10.6, fitW: 11.4, az: deg(33), el: deg(43) },
  { tx: 2.2, ty: 0.3, tz: 0, fitH: 11.8, fitW: 16.2, az: deg(33), el: deg(47) },
];

/**
 * The staffing scene runs along one axis, from the market to the team. A tall stage
 * views it end-on so it climbs the screen; a wide stage views it from the side.
 */
const TEAM_POSE_TALL: CameraPose = { tx: 4.1, ty: 0.3, tz: 0, fitH: 10.6, fitW: 9.8, az: deg(-76), el: deg(38) };
const TEAM_POSE_WIDE: CameraPose = { tx: 4.0, ty: 0.3, tz: 0, fitH: 6.6, fitW: 15.2, az: deg(16), el: deg(38) };

function mixPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return {
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t),
    tz: lerp(a.tz, b.tz, t),
    fitH: lerp(a.fitH, b.fitH, t),
    fitW: lerp(a.fitW, b.fitW, t),
    az: lerp(a.az, b.az, t),
    el: lerp(a.el, b.el, t),
  };
}

interface StoryState {
  pose: CameraPose;
  explode: number;
  arc: number;
  figure: number;
  sheet: number;
  handoff: number;
  labels: { config: number; bom: number; quote: number; flow: number };
}

/** Everything the worked-example scene needs, as a function of scroll progress 0 to 4. */
function storyAt(progress: number): StoryState {
  const p = Math.min(4, Math.max(0, progress));
  const seg = Math.min(3, Math.floor(p));
  const t = clamp01(p - seg);
  const state: StoryState = {
    pose: mixPose(POSES[seg], POSES[seg + 1], t),
    explode: 0,
    arc: 0,
    figure: 0,
    sheet: 0,
    handoff: 0,
    labels: { config: 0, bom: 0, quote: 0, flow: 0 },
  };
  if (seg === 0) {
    state.arc = span(t, 0.2, 1);
    state.labels.config = span(t, 0.6, 1);
  } else if (seg === 1) {
    state.arc = 1 - span(t, 0, 0.4);
    state.labels.config = 1 - span(t, 0, 0.3);
    state.explode = span(t, 0.15, 1);
    state.labels.bom = span(t, 0.65, 1);
  } else if (seg === 2) {
    // reassemble first, then shrink onto the sheet as it arrives
    state.explode = 1 - span(t, 0, 0.55);
    state.labels.bom = 1 - span(t, 0, 0.25);
    state.figure = easeInOut(span(t, 0.35, 1));
    state.sheet = span(t, 0.25, 0.9);
    state.labels.quote = span(t, 0.82, 1);
  } else {
    state.figure = 1;
    state.sheet = 1;
    state.handoff = span(t, 0.1, 1);
    state.labels.quote = 1 - span(t, 0, 0.3);
    state.labels.flow = span(t, 0.7, 1);
  }
  return state;
}

const PHASE_NAMES = ['Align', 'Source', 'Screen', 'Coordinate'];

/** Starts the stage. Resolves to false when WebGL is unavailable, so the caller can fall back. */
export async function initStage(workbench: Workbench): Promise<boolean> {
  const root = document.documentElement;
  const story = document.querySelector<HTMLElement>('[data-story]');
  const unitSlot = document.querySelector<HTMLElement>('[data-stage-slot]');
  const unitLabelHost = document.querySelector<HTMLElement>('[data-stage-labels]');
  const staffing = document.querySelector<HTMLElement>('[data-staffing]');
  const teamSlot = document.querySelector<HTMLElement>('[data-team-slot]');
  const teamLabelHost = document.querySelector<HTMLElement>('[data-team-labels]');
  const teamCaption = document.querySelector<HTMLElement>('[data-team-caption]');

  if (!story || !unitSlot || !webglAvailable()) return false;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const lowPower =
    Boolean(connection?.saveData) ||
    (navigator.hardwareConcurrency ?? 8) <= 4 ||
    window.matchMedia('(max-width: 48rem)').matches;

  let rig: Rig;
  try {
    rig = new Rig({ lowPower, reducedMotion });
  } catch (error) {
    console.warn('WebGL could not start; the page continues with static posters.', error);
    return false;
  }

  // Only the machine is needed for the first frame. The quote sheet and the staffing
  // scene are built afterwards, one per idle period, so start-up never blocks for long.
  const materials = createMaterials();
  const unit = new Unit(materials);
  let quote: Quote | null = null;
  let team: Team | null = null;
  const unitWorld = new Group();
  unitWorld.add(unit.root);
  const teamWorld = new Group();
  rig.scene.add(unitWorld, teamWorld);

  let evaluation: Evaluation = workbench.current();
  unit.apply(evaluation);
  let family: Family = 'apps';

  const buildQuote = () => {
    if (quote) return quote;
    quote = new Quote(materials);
    quote.apply(evaluation);
    unitWorld.add(quote.root);
    return quote;
  };
  const buildTeam = () => {
    if (team) return team;
    team = new Team(materials);
    team.setFamily(family);
    team.snap();
    teamWorld.add(team.root);
    return team;
  };

  // ------------------------------------------------------------------ labels
  const unitLabels = unitLabelHost ? new LabelLayer(unitLabelHost, rig) : null;
  const teamLabels = teamLabelHost ? new LabelLayer(teamLabelHost, rig) : null;

  const config = unitLabels && {
    reach: unitLabels.add({ dx: 26, dy: 30 }),
    tool: unitLabels.add({ dx: 54, dy: -6 }),
    power: unitLabels.add({ dx: -40, dy: -64 }),
    ballast: unitLabels.add({ dx: -86, dy: -30 }),
  };
  const bomOffsets: Record<string, [number, number]> = {
    'HX6-BASE': [-150, 44],
    'HX6-ARM-14': [34, -50],
    'HX6-BAL-01': [-120, -34],
    'HX6-TL-GRP': [46, 22],
    'HX6-TL-VAC': [46, 22],
    'HX6-TL-HOK': [46, 22],
    'HX6-PMP-KIT': [-130, 50],
    'HX6-PWR-E': [-26, -62],
  };
  const bom = new Map<string, Label>();
  if (unitLabels) {
    for (const [part, [dx, dy]] of Object.entries(bomOffsets)) bom.set(part, unitLabels.add({ dx, dy, variant: 'bom' }));
  }
  const quoteLabels = unitLabels && {
    total: unitLabels.add({ dx: 40, dy: 34 }),
    stamp: unitLabels.add({ dx: 36, dy: 46 }),
  };
  const flowLabels = unitLabels && {
    crm: unitLabels.add({ dx: 30, dy: -50 }),
    erp: unitLabels.add({ dx: 30, dy: 52 }),
  };
  const teamTags = teamLabels && {
    team: teamLabels.add({ dx: -30, dy: -92, brief: true }),
    seat: teamLabels.add({ dx: 70, dy: 58, brief: true }),
    pool: teamLabels.add({ dx: 24, dy: -86, brief: true }),
    flag: teamLabels.add({ dx: 22, dy: -74, brief: true }),
    line: teamLabels.add({ dx: 30, dy: 70, brief: true }),
  };

  const included = new Set<string>();
  const writeLabels = (e: Evaluation) => {
    if (config) {
      config.reach.set('Reach', e.selection.reach === 'long' ? '14 m' : '9 m');
      config.tool.set('Tool', e.tool.find((o) => o.value === e.selection.tool)?.label ?? '');
      config.power.set('Power', e.power.find((o) => o.value === e.selection.power)?.label ?? '');
      config.ballast.set('Ballast', `${e.ballastBlocks} block${e.ballastBlocks > 1 ? 's' : ''}`);
    }
    included.clear();
    for (const line of e.bom) {
      included.add(line.part);
      bom.get(line.part)?.set(line.part, money(line.unitPrice));
    }
    if (quoteLabels) {
      quoteLabels.total.set('Total', money(e.pricing.total));
      quoteLabels.stamp.set('Approval', e.approvalRequired ? 'Awaiting sign-off' : 'Within authority');
    }
  };
  writeLabels(evaluation);
  flowLabels?.crm.set('CRM', 'Opportunity');
  flowLabels?.erp.set('ERP', 'Sales order');

  workbench.subscribe((next) => {
    evaluation = next;
    unit.apply(next);
    quote?.apply(next);
    writeLabels(next);
    rig.invalidate();
  });

  // ------------------------------------------------------------------ which scene is on stage
  type World = 'unit' | 'team';
  let world: World = 'unit';
  const setWorld = (next: World) => {
    world = next;
    if (next === 'team') buildTeam();
    unitWorld.visible = next === 'unit';
    teamWorld.visible = next === 'team';
    rig.mount(next === 'unit' ? unitSlot : teamSlot!);
    if (next === 'unit') teamLabels?.hideAll();
    else unitLabels?.hideAll();
    applyScroll();
    rig.invalidate();
  };

  // ------------------------------------------------------------------ scroll direction
  const steps = Array.from(story.querySelectorAll<HTMLElement>('[data-step]'));
  const phases = staffing ? Array.from(staffing.querySelectorAll<HTMLElement>('[data-phase]')) : [];
  const desktop = window.matchMedia('(min-width: 64rem)');
  let progress = 0;
  let state = storyAt(0);
  let phase = 0;

  const readProgress = () => {
    const vh = window.innerHeight;
    // On small screens the stage sits above the text, so a chapter "arrives" lower down.
    const focus = vh * (desktop.matches ? 0.62 : 0.74);
    const zone = vh * (desktop.matches ? 0.5 : 0.34);
    let p = 0;
    for (const step of steps) p += easeInOut(clamp01((focus - step.getBoundingClientRect().top) / zone));
    return p;
  };

  const readPhase = () => {
    const focus = window.innerHeight * (desktop.matches ? 0.56 : 0.7);
    let current = 0;
    phases.forEach((el, index) => {
      if (el.getBoundingClientRect().top <= focus) current = index;
    });
    return current;
  };

  function applyScroll() {
    if (world === 'unit') {
      progress = readProgress();
      state = storyAt(progress);
      rig.setPose(state.pose);
      unit.setExplode(state.explode);
      unit.setArc(state.arc);
      // The quote sheet is built the moment the visitor first scrolls towards it.
      if (state.sheet > 0 || state.figure > 0) buildQuote();
      quote?.setPresence(state.sheet);
      quote?.setHandoff(state.handoff);
    } else {
      const next = readPhase();
      if (next !== phase || !phases.some((el) => el.classList.contains('is-current'))) {
        phase = next;
        phases.forEach((el, index) => el.classList.toggle('is-current', index === phase));
        if (teamCaption) teamCaption.textContent = PHASE_NAMES[phase] ?? '';
      }
      buildTeam().setPhase(phase);
      const { width, height } = rig.size;
      rig.setPose(width / height < 1.15 ? TEAM_POSE_TALL : TEAM_POSE_WIDE);
    }
  }

  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      applyScroll();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  if (staffing && teamSlot) {
    staffing.querySelectorAll<HTMLInputElement>('input[name="family"]').forEach((input) => {
      if (input.checked) family = input.value as Family;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        family = input.value as Family;
        team?.setFamily(family);
        rig.invalidate();
      });
    });
    // Phases can also be stepped through directly, without scrolling.
    phases.forEach((el, index) => {
      el.addEventListener('click', () => {
        if (index === phase) return;
        el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    });

    const stageHosts = new Map<Element, World>([
      [unitSlot, 'unit'],
      [teamSlot, 'team'],
    ]);
    const near = new Set<World>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const which = stageHosts.get(entry.target)!;
          if (entry.isIntersecting) near.add(which);
          else near.delete(which);
        }
        const wanted: World = near.has('team') && !near.has('unit') ? 'team' : near.has('unit') ? 'unit' : world;
        if (wanted !== world) setWorld(wanted);
      },
      { rootMargin: '35% 0px 35% 0px' },
    );
    observer.observe(unitSlot);
    observer.observe(teamSlot);
  }

  // ------------------------------------------------------------------ per frame
  const point = new Vector3();
  const figure = new Spring(0, 70, 17);
  const weights = { config: 0, bom: 0, quote: 0, flow: 0 };
  const teamWeights = { team: 0, seat: 0, pool: 0, flag: 0, line: 0 };
  let time = 0;

  const ease = (current: number, target: number, dt: number) =>
    reducedMotion ? target : current + (target - current) * Math.min(1, dt * 9);

  rig.onFrame((dt) => {
    time += dt;
    let active = false;

    if (world === 'unit') {
      // In the opening the upper structure sweeps slowly through its working arc.
      const idle = !reducedMotion && progress < 0.5;
      unit.setSlew(idle ? Math.sin(time * 0.38) * 0.2 * (1 - progress * 2) : 0);

      figure.target = state.figure;
      if (reducedMotion) figure.snap();
      else if (figure.step(dt)) active = true;
      const f = clamp01(figure.value);
      if (quote) quote.figureWorld(point);
      else point.set(0, 0, 0);
      unit.root.position.set(point.x * f, point.y * f, point.z * f);
      unit.root.scale.setScalar(lerp(1, 0.3, f));

      if (unit.update(dt, reducedMotion)) active = true;
      if (quote?.update(dt, reducedMotion, !reducedMotion)) active = true;
      if (idle) active = true;

      if (unitLabels) {
        unitLabels.begin();
        let settling = false;
        for (const key of ['config', 'bom', 'quote', 'flow'] as const) {
          const next = ease(weights[key], state.labels[key], dt);
          if (Math.abs(next - weights[key]) > 0.002) settling = true;
          weights[key] = next;
        }
        if (settling) active = true;
        if (config) {
          unitLabels.place(config.reach, unit.anchor('reach', point), weights.config);
          unitLabels.place(config.tool, unit.anchor('tool', point), weights.config);
          unitLabels.place(config.power, unit.anchor('power', point), weights.config);
          unitLabels.place(config.ballast, unit.anchor('ballast', point), weights.config);
        }
        for (const [part, label] of bom) {
          const shown = included.has(part) && unit.bomAnchor(part, point);
          unitLabels.place(label, point, shown ? weights.bom : 0);
        }
        if (quoteLabels && quote) {
          unitLabels.place(quoteLabels.total, quote.anchor('total', point), weights.quote);
          unitLabels.place(quoteLabels.stamp, quote.anchor('stamp', point), weights.quote);
        }
        if (flowLabels && quote) {
          unitLabels.place(flowLabels.crm, quote.anchor('crm', point), weights.flow);
          unitLabels.place(flowLabels.erp, quote.anchor('erp', point), weights.flow);
        }
      }
    } else if (team) {
      if (team.update(dt, reducedMotion)) active = true;
      if (teamLabels && teamTags) {
        teamLabels.begin();
        const targets = {
          team: phase === 0 ? 1 : 0,
          seat: phase === 0 || phase === 3 ? 1 : 0,
          pool: phase === 1 ? 1 : 0,
          flag: phase === 2 ? 1 : 0,
          line: phase >= 2 ? 1 : 0,
        };
        let settling = false;
        for (const key of Object.keys(targets) as (keyof typeof targets)[]) {
          const next = ease(teamWeights[key], targets[key], dt);
          if (Math.abs(next - teamWeights[key]) > 0.002) settling = true;
          teamWeights[key] = next;
        }
        if (settling) active = true;
        teamTags.team.set('Your team', '');
        teamTags.seat.set(phase === 3 ? 'Seat filled' : 'Open seat', phase === 3 ? 'Onboarding coordinated' : 'Must-haves agreed');
        teamTags.pool.set('Sourced', 'Interested and available');
        teamTags.flag.set('Flagged', 'Gap to probe at interview');
        teamTags.line.set('Shortlist', phase === 3 ? 'Interviews and feedback' : 'Meets the must-haves');
        teamLabels.place(teamTags.team, team.anchor('team', point), teamWeights.team);
        teamLabels.place(teamTags.seat, team.anchor('seat', point), teamWeights.seat);
        teamLabels.place(teamTags.pool, team.anchor('pool', point), teamWeights.pool);
        teamLabels.place(teamTags.flag, team.anchor('flag', point), teamWeights.flag);
        teamLabels.place(teamTags.line, team.anchor('line', point), teamWeights.line);
      }
    }
    return active;
  });

  // ------------------------------------------------------------------ first frame
  teamWorld.visible = false;
  rig.mount(unitSlot);
  applyScroll();
  if (reducedMotion || progress > 0.4) {
    // Arriving mid-page or with reduced motion: show the settled state immediately.
    unit.snap();
    // applyScroll() may have built the quote sheet already when arriving mid-page.
    (quote as Quote | null)?.snap();
    figure.snap(state.figure);
  } else {
    unit.startIntro();
  }

  try {
    // Compile shaders before the canvas is shown, so the first frames do not stutter.
    await rig.renderer.compileAsync(rig.scene, rig.camera);
  } catch {
    // Not fatal: shaders will compile on first use instead.
  }

  rig.invalidate();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      rig.canvas.classList.add('is-ready');
      root.classList.add('has-stage');
    }),
  );

  // Build the remaining scenes while the browser is idle, well before they are scrolled to.
  const idle = (work: () => void) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(work, { timeout: 4000 });
    else setTimeout(work, 1200);
  };
  idle(() => {
    buildQuote();
    idle(() => buildTeam());
  });
  return true;
}
