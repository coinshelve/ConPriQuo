import type { Vector3 } from 'three';
import type { Rig } from './rig';

export interface LabelSpec {
  /** Pixel offset from the projected anchor to the label, at desktop size. */
  dx: number;
  dy: number;
  /**
   * Offset in absolute pixels on a compact stage (narrower than 520 px). There the
   * anchors sit so close together that scaled-down desktop offsets put neighbouring
   * labels on top of each other, so each label can name its own clear spot instead.
   */
  compact?: { dx: number; dy: number };
  /** Extra class for a label variant. */
  variant?: string;
  /** On a narrow stage, show only the key and drop the longer second line. */
  brief?: boolean;
}

export interface Label {
  el: HTMLElement;
  line: SVGLineElement;
  spec: LabelSpec;
  /** Measured size, refreshed whenever the text changes. */
  width: number;
  height: number;
  stale: boolean;
  set(key: string, value: string): void;
}

/** Below this stage width the compact layout applies. */
const COMPACT_BELOW = 520;
/** Minimum distance between a label and the stage edge. */
const EDGE = 6;
const EDGE_COMPACT = 12;
/** Clear space kept between two labels. */
const GAP = 3;
/** A label this close beside its own anchor counts as covering the part it names. */
const COVER_MARGIN = 16;

/**
 * HTML call-outs over the canvas. Each label follows a 3D anchor through the camera
 * projection and is joined to it by a leader line, the way a technical drawing
 * annotates a part. Labels are kept inside the stage so nothing is cut off on a
 * narrow screen. The layer is aria-hidden: everything it says is also in the page.
 *
 * Labels are placed in the order the caller gives them, most important first. One that
 * would land on a label already placed in the same frame moves to the other side of its
 * anchor, and on a compact stage it is left out if that side is taken too, so two labels
 * never overlap there.
 */
export class LabelLayer {
  private svg: SVGSVGElement;
  private labels: Label[] = [];
  private screen = { x: 0, y: 0 };
  private compact = false;
  /** Boxes taken so far this frame: left, top, right, bottom for each label placed. */
  private taken: number[] = [];

  /**
   * @param footer Height in pixels at the bottom of a compact stage that labels stay
   *   out of, for the caption the page prints there.
   */
  constructor(
    private container: HTMLElement,
    private rig: Rig,
    private footer = 0,
  ) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'stage-leaders');
    this.svg.setAttribute('aria-hidden', 'true');
    container.append(this.svg);
  }

  add(spec: LabelSpec): Label {
    const el = document.createElement('div');
    el.className = `stage-label${spec.variant ? ` stage-label--${spec.variant}` : ''}${spec.brief ? ' stage-label--brief' : ''}`;
    const k = document.createElement('span');
    k.className = 'stage-label__k';
    const v = document.createElement('span');
    v.className = 'stage-label__v';
    el.append(k, v);
    this.container.append(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.svg.append(line);
    const label: Label = {
      el,
      line,
      spec,
      width: 0,
      height: 0,
      stale: true,
      set(key, value) {
        if (k.textContent !== key) {
          k.textContent = key;
          label.stale = true;
        }
        if (v.textContent !== value) {
          v.textContent = value;
          v.hidden = !value;
          label.stale = true;
        }
      },
    };
    this.labels.push(label);
    return label;
  }

  /** Call once per frame before placing labels. */
  begin() {
    const { width, height } = this.rig.size;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.taken.length = 0;
    const compact = width < COMPACT_BELOW;
    if (compact !== this.compact) {
      this.compact = compact;
      this.container.classList.toggle('is-compact', compact);
      for (const label of this.labels) label.stale = true;
    }
  }

  /**
   * Position a label at a world point with the given opacity weight (0 hides it).
   * On a compact stage, call for the most important labels first.
   */
  place(label: Label, world: Vector3, weight: number) {
    if (weight <= 0.02) {
      this.hide(label);
      return;
    }
    const { width, height } = this.rig.size;
    const { compact } = this;
    this.rig.project(world, this.screen);
    if (label.stale) {
      label.width = label.el.offsetWidth;
      label.height = label.el.offsetHeight;
      label.stale = false;
    }
    const own = compact ? label.spec.compact : undefined;
    const scale = compact ? 0.52 : width < 760 ? 0.75 : 1;
    const dx = own ? own.dx : label.spec.dx * scale;
    const dy = own ? own.dy : label.spec.dy * scale;
    let alignRight = dx < 0;

    // keep the whole label inside the stage
    const edge = compact ? EDGE_COMPACT : EDGE;
    const floor = height - edge - (compact ? this.footer : 0);
    const maxLeft = width - edge - label.width;
    const wanted = this.screen.x + dx - (alignRight ? label.width : 0);
    let left = Math.max(edge, Math.min(maxLeft, wanted));
    const top = Math.max(edge, Math.min(floor - label.height, this.screen.y + dy - label.height / 2));
    label.line.setAttribute('x1', this.screen.x.toFixed(1));
    label.line.setAttribute('y1', this.screen.y.toFixed(1));

    // Two things can spoil the chosen side. An anchor close to the stage edge leaves no
    // room there, so the label is pushed back over the very part it names; or the spot
    // is already taken by a label placed earlier this frame. Either way the label moves
    // to the other side of its anchor if that side is free. If it is not, a compact
    // stage leaves the label out; a larger one keeps it where it was.
    const covers =
      left !== wanted &&
      this.screen.y > top &&
      this.screen.y < top + label.height &&
      this.screen.x > left - COVER_MARGIN &&
      this.screen.x < left + label.width + COVER_MARGIN;
    const collides = !this.isFree(left, top, label);
    if (covers || collides) {
      const mirrored = this.screen.x - dx - (alignRight ? 0 : label.width);
      if (mirrored >= edge && mirrored <= maxLeft && this.isFree(mirrored, top, label)) {
        left = mirrored;
        alignRight = !alignRight;
      } else if (collides && compact) {
        this.hide(label);
        return;
      }
    }
    this.taken.push(left, top, left + label.width, top + label.height);

    const lx = alignRight ? left + label.width : left;
    const ly = top + label.height / 2;
    const opacity = Math.min(1, weight * 1.5);
    label.el.style.opacity = opacity.toFixed(3);
    label.el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(${alignRight ? '-100%' : '0'}, -50%)`;
    label.line.style.opacity = (opacity * 0.75).toFixed(3);
    label.line.setAttribute('x2', lx.toFixed(1));
    label.line.setAttribute('y2', ly.toFixed(1));
  }

  /** Whether a label put at this position would stay clear of every label placed this frame. */
  private isFree(left: number, top: number, label: Label) {
    const right = left + label.width;
    const bottom = top + label.height;
    const t = this.taken;
    for (let i = 0; i < t.length; i += 4) {
      if (left < t[i + 2] + GAP && right > t[i] - GAP && top < t[i + 3] + GAP && bottom > t[i + 1] - GAP) return false;
    }
    return true;
  }

  hide(label: Label) {
    if (label.el.style.opacity !== '0') {
      label.el.style.opacity = '0';
      label.line.style.opacity = '0';
    }
  }

  hideAll() {
    for (const label of this.labels) this.hide(label);
  }
}
