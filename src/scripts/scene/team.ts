import { CylinderGeometry, Group, Mesh, Object3D, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { BufferGeometry, Material } from 'three';
import type { Materials } from './palette';
import { Spring } from './spring';
import { extrudeFlat, openHexShape } from './unit';

export type Family = 'apps' | 'engineering' | 'cloud';

/**
 * The staffing scene. The open hexagon is the client's team with one seat to fill;
 * the dots are people: white for the client's own, the brand colours for specialists. Four phases follow the shortlist process exactly as the
 * company describes it: Align, Source, Screen, Coordinate.
 */
const DOT_R = 0.34;
const PAD: [number, number][] = [
  [-0.95, 0],
  [0, -0.95],
  [0, 0.95],
  [0.95, 0],
];

interface Candidate {
  node: Mesh;
  family: Family;
  /** Order within its family: 0 to 4. */
  rank: number;
  market: [number, number];
  x: Spring;
  z: Spring;
  scale: Spring;
  lift: number;
}

function mesh(geometry: BufferGeometry, material: Material) {
  const m = new Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Where the five candidates of the chosen family gather once sourced.
const SOURCED: [number, number][] = [
  [4.0, -1.35],
  [5.0, -0.45],
  [4.25, 0.6],
  [5.55, 1.0],
  [6.1, -1.5],
];
// The shortlist lines up at the opening, like the bar in the logo.
const LINE: [number, number][] = [
  [3.4, 0],
  [4.6, 0],
  [5.8, 0],
];

export class Team {
  readonly root = new Group();
  private candidates: Candidate[] = [];
  private family: Family = 'apps';
  private phase = 0;
  private flag: Mesh;
  private flagScale = new Spring(0, 200, 18);
  private anchors = new Map<string, Object3D>();

  constructor(private materials: Materials) {
    const m = materials;

    const frame = mesh(extrudeFlat(openHexShape(2.55, 0.5, 0.44, 0.22), 0.3, 0.05), m.frame);
    this.root.add(frame);

    // seats: three taken by the client's own people, one open
    const padGeometry = new CylinderGeometry(0.47, 0.47, 0.06, 40);
    PAD.forEach(([x, z], index) => {
      const pad = mesh(padGeometry, m.deck);
      pad.position.set(x, 0.03, z);
      pad.castShadow = false;
      this.root.add(pad);
      if (index < 3) {
        const person = mesh(new SphereGeometry(DOT_R, 40, 28), m.white);
        person.position.set(x, 0.06 + DOT_R, z);
        this.root.add(person);
      }
    });

    // the market: fifteen people, five per skill family, mixed together beyond the opening
    const dotGeometry = new SphereGeometry(DOT_R, 40, 28);
    const families: [Family, Material][] = [
      ['apps', m.magenta],
      ['engineering', m.cyan],
      ['cloud', m.orange],
    ];
    // which family stands in each of the fifteen places, so the colours are interleaved
    const places = [0, 1, 2, 1, 2, 0, 2, 0, 1, 0, 2, 1, 1, 0, 2];
    const ranks = [0, 0, 0];
    let seed = 7;
    const random = () => {
      // small deterministic generator so the layout is identical on every visit
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    places.forEach((f, place) => {
      const [family, material] = families[f];
      const column = place % 5;
      const row = Math.floor(place / 5);
      const market: [number, number] = [
        7.3 + column * 0.86 + (row % 2) * 0.4 + (random() - 0.5) * 0.3,
        (row - 1) * 2.05 + (random() - 0.5) * 0.9,
      ];
      const node = mesh(dotGeometry, material);
      node.position.set(market[0], DOT_R, market[1]);
      this.root.add(node);
      this.candidates.push({
        node,
        family,
        rank: ranks[f]++,
        market,
        x: new Spring(market[0], 46, 13),
        z: new Spring(market[1], 46, 13),
        scale: new Spring(0.62, 160, 20),
        lift: 0,
      });
    });

    // the gap flagged for interview: a small ring carried by one shortlisted candidate
    this.flag = mesh(new TorusGeometry(DOT_R + 0.1, 0.045, 12, 48), m.orange);
    this.flag.rotation.x = Math.PI / 2;
    this.flag.castShadow = false;
    this.root.add(this.flag);

    const anchor = (name: string, x: number, y: number, z: number) => {
      const node = new Object3D();
      node.position.set(x, y, z);
      this.root.add(node);
      this.anchors.set(name, node);
    };
    anchor('seat', PAD[3][0], 0.3, PAD[3][1]);
    anchor('team', -0.95, 0.75, 0);
    anchor('pool', 5.0, 0.6, -1.0);
    anchor('flag', LINE[1][0], 0.9, LINE[1][1]);
    anchor('line', LINE[2][0], 0.35, 0);
    anchor('market', 8.4, 0.4, 3.4);
  }

  setFamily(family: Family) {
    this.family = family;
  }

  /** 0 Align, 1 Source, 2 Screen, 3 Coordinate. Fractions blend between phases. */
  setPhase(phase: number) {
    this.phase = phase;
  }

  anchor(name: string, out: Vector3) {
    const node = this.anchors.get(name);
    if (!node) return out.set(0, 0, 0);
    return node.getWorldPosition(out);
  }

  snap() {
    this.update(0, true);
  }

  update(dt: number, snap = false): boolean {
    let active = false;
    const phase = Math.round(this.phase);
    for (const c of this.candidates) {
      const chosen = c.family === this.family;
      let target = c.market;
      let scale = 0.62;
      if (chosen && phase >= 1) {
        target = SOURCED[c.rank];
        scale = 1;
      }
      if (chosen && phase >= 2) {
        if (c.rank < 3) target = LINE[c.rank];
        else {
          // not a match for the must-haves: back to the market
          target = c.market;
          scale = 0.62;
        }
      }
      if (chosen && phase >= 3 && c.rank === 0) target = PAD[3];
      c.x.target = target[0];
      c.z.target = target[1];
      c.scale.target = scale;
      if (snap) {
        c.x.snap();
        c.z.snap();
        c.scale.snap();
        c.lift = 0;
      } else {
        const moving = [c.x.step(dt), c.z.step(dt), c.scale.step(dt)].some(Boolean);
        if (moving) active = true;
        // people hop a little as they move, and settle as they arrive
        const speed = Math.hypot(c.x.velocity, c.z.velocity);
        const wanted = Math.min(0.55, speed * 0.085);
        c.lift += (wanted - c.lift) * Math.min(1, dt * 9);
        if (c.lift > 0.004) active = true;
      }
      const s = c.scale.value;
      const seated = chosen && phase >= 3 && c.rank === 0 ? 0.06 : 0;
      c.node.scale.setScalar(s);
      c.node.position.set(c.x.value, DOT_R * s + c.lift + seated, c.z.value);
    }

    // the flag follows the second person in the line while screening and after
    const flagged = this.candidates.find((c) => c.family === this.family && c.rank === 1);
    this.flagScale.target = phase >= 2 ? 1 : 0;
    if (snap) this.flagScale.snap();
    else if (this.flagScale.step(dt)) active = true;
    const fs = Math.max(0, this.flagScale.value);
    this.flag.visible = fs > 0.01;
    this.flag.material = this.family === 'cloud' ? this.materials.white : this.materials.orange;
    if (flagged) {
      this.flag.position.set(flagged.node.position.x, flagged.node.position.y + 0.02, flagged.node.position.z);
      this.flag.scale.setScalar(fs);
      const flagAnchor = this.anchors.get('flag');
      flagAnchor?.position.set(flagged.node.position.x, flagged.node.position.y + 0.5, flagged.node.position.z);
    }
    return active;
  }
}
