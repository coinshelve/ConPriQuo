import type { Vector3 } from 'three';
import type { Rig } from './rig';

export interface LabelSpec {
  /** Pixel offset from the projected anchor to the label, at desktop size. */
  dx: number;
  dy: number;
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

const EDGE = 6;

/**
 * HTML call-outs over the canvas. Each label follows a 3D anchor through the camera
 * projection and is joined to it by a leader line, the way a technical drawing
 * annotates a part. Labels are kept inside the stage so nothing is cut off on a
 * narrow screen. The layer is aria-hidden: everything it says is also in the page.
 */
export class LabelLayer {
  private svg: SVGSVGElement;
  private labels: Label[] = [];
  private screen = { x: 0, y: 0 };
  private compact = false;

  constructor(
    private container: HTMLElement,
    private rig: Rig,
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
    const compact = width < 520;
    if (compact !== this.compact) {
      this.compact = compact;
      this.container.classList.toggle('is-compact', compact);
      for (const label of this.labels) label.stale = true;
    }
  }

  /** Position a label at a world point with the given opacity weight (0 hides it). */
  place(label: Label, world: Vector3, weight: number) {
    if (weight <= 0.02) {
      this.hide(label);
      return;
    }
    const { width, height } = this.rig.size;
    this.rig.project(world, this.screen);
    if (label.stale) {
      label.width = label.el.offsetWidth;
      label.height = label.el.offsetHeight;
      label.stale = false;
    }
    const scale = width < 520 ? 0.52 : width < 760 ? 0.75 : 1;
    const alignRight = label.spec.dx < 0;
    let lx = this.screen.x + label.spec.dx * scale;
    let ly = this.screen.y + label.spec.dy * scale;
    // keep the whole label inside the stage
    const left = alignRight ? lx - label.width : lx;
    if (left < EDGE) lx += EDGE - left;
    if (left + label.width > width - EDGE) lx -= left + label.width - (width - EDGE);
    ly = Math.min(height - EDGE - label.height / 2, Math.max(EDGE + label.height / 2, ly));

    const opacity = Math.min(1, weight * 1.5);
    label.el.style.opacity = opacity.toFixed(3);
    label.el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(${alignRight ? '-100%' : '0'}, -50%)`;
    label.line.style.opacity = (opacity * 0.75).toFixed(3);
    label.line.setAttribute('x1', this.screen.x.toFixed(1));
    label.line.setAttribute('y1', this.screen.y.toFixed(1));
    label.line.setAttribute('x2', lx.toFixed(1));
    label.line.setAttribute('y2', ly.toFixed(1));
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
