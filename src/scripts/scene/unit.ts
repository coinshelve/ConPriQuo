import {
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Evaluation } from '../cpq/engine';
import { BRAND } from './palette';
import type { Materials } from './palette';
import { Spring } from './spring';

/** Arm geometry in scene units. 4.4 units stands for the 9 m arm, 6.6 for the 14 m arm. */
const ARM_START = 0.45;
const ARM_STD = 4.4;
const ARM_LONG = 6.6;
const ARM_Y = 1.92;
const ARM_R = 0.26;

interface PartSpec {
  /** Bill-of-materials part this piece belongs to, used to group the exploded view. */
  bom: string;
  node: Object3D;
  rest: Vector3;
  /** Offset applied at full explosion. */
  explode: Vector3;
  /** Whether the current configuration includes the piece. */
  present: (e: Evaluation) => boolean;
  /** Pieces that ride on the arm tip follow the reach. */
  followsTip?: boolean;
}

interface Part extends PartSpec {
  x: Spring;
  y: Spring;
  z: Spring;
  scale: Spring;
  /** Position in the entrance sequence, 0 to 1. */
  order: number;
}

function cast<T extends Object3D>(object: T): T {
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return object;
}

function mesh(geometry: BufferGeometry, material: Material) {
  return new Mesh(geometry, material);
}

/** Closed polygon with softened corners. */
function roundedShape(points: Vector2[], radius: number) {
  const shape = new Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const here = points[i];
    const next = points[(i + 1) % n];
    const toPrev = prev.clone().sub(here);
    const toNext = next.clone().sub(here);
    const r = Math.min(radius, toPrev.length() / 2.2, toNext.length() / 2.2);
    const a = here.clone().add(toPrev.normalize().multiplyScalar(r));
    const b = here.clone().add(toNext.normalize().multiplyScalar(r));
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(here.x, here.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}

const polar = (degrees: number, radius: number) =>
  new Vector2(Math.cos((degrees * Math.PI) / 180) * radius, Math.sin((degrees * Math.PI) / 180) * radius);

/**
 * The open hexagon from the logo mark, extruded: flat top and bottom edges, a vertex
 * to the left, and an opening on the right through which the arm leaves.
 */
export function openHexShape(outer: number, band: number, opening: number, corner = 0.26) {
  const cut = (radius: number, sign: number) => polar(60 * sign, radius).lerp(polar(0, radius), opening);
  const inner = outer - band;
  return roundedShape(
    [
      cut(outer, 1),
      polar(60, outer),
      polar(120, outer),
      polar(180, outer),
      polar(240, outer),
      polar(300, outer),
      cut(outer, -1),
      cut(inner, -1),
      polar(300, inner),
      polar(240, inner),
      polar(180, inner),
      polar(120, inner),
      polar(60, inner),
      cut(inner, 1),
    ],
    corner,
  );
}

export function extrudeFlat(shape: Shape, depth: number, bevel = 0.05) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  // Shape lies in XY with +Y mapping to -Z after the rotation; extrusion becomes +Y.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  return geometry;
}

/** A profile drawn in XY that stays upright, given its thickness along Z and centred there. */
function extrudeUpright(shape: Shape, thickness: number, bevel = 0.03) {
  const depth = thickness - bevel * 2;
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function hexPrism(radius: number, height: number, corner = 0.12) {
  const points = [0, 60, 120, 180, 240, 300].map((d) => polar(d, radius));
  return extrudeFlat(roundedShape(points, corner), height - 0.06, 0.03);
}

/**
 * The HX-6: a fictional configurable handling unit built from the logo's own geometry.
 * The open hexagon is its base frame, the magenta bar is its arm, and the dots are the
 * tools it can carry. On the navy stage the frame is white, as the mark reads reversed.
 */
export class Unit {
  readonly root = new Group();
  /** Everything that turns with the upper structure. */
  readonly upper = new Group();
  private parts: Part[] = [];
  private reach = new Spring(ARM_STD, 120, 22);
  private explodeAmount = new Spring(0, 90, 20);
  private slew = new Spring(0, 30, 11);
  private armExtension!: Mesh;
  private armTip!: Mesh;
  private hanger!: Mesh;
  private reachArc!: Mesh;
  private arcMaterial = new MeshBasicMaterial({ color: BRAND.white, transparent: true, opacity: 0.3, depthWrite: false });
  private arcOpacity = new Spring(0, 80, 18);
  private evaluation: Evaluation | null = null;
  private anchors = new Map<string, Object3D>();
  /** Entrance progress: parts seat one after another as this runs from 0 to 1. */
  private intro = 1;

  constructor(private materials: Materials) {
    this.root.add(this.upper);
    this.build();
    this.parts.forEach((part, index) => (part.order = index / this.parts.length));
  }

  /** Begin the entrance: the unit assembles itself part by part. */
  startIntro() {
    this.intro = 0;
    for (const part of this.parts) {
      part.scale.snap(0);
      part.y.snap(part.rest.y + 1.6);
    }
  }

  private add(spec: PartSpec, parent: Object3D = this.upper) {
    cast(spec.node);
    spec.node.position.copy(spec.rest);
    parent.add(spec.node);
    const part: Part = {
      ...spec,
      x: new Spring(spec.rest.x, 110, 21),
      y: new Spring(spec.rest.y, 110, 21),
      z: new Spring(spec.rest.z, 110, 21),
      // slightly under-damped so parts seat with a small, mechanical overshoot
      scale: new Spring(1, 210, 19),
      order: 0,
    };
    this.parts.push(part);
    return part;
  }

  private build() {
    const m = this.materials;
    const always = () => true;
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

    // ---- lower structure (does not turn)
    const frame = new Group();
    frame.add(mesh(extrudeFlat(openHexShape(3.0, 0.58, 0.44), 0.4, 0.06), m.frame));
    // a fixing at each closed corner of the frame gives the eye something to measure against
    const fixing = new CylinderGeometry(0.12, 0.12, 0.05, 20);
    for (const degrees of [60, 120, 180, 240, 300]) {
      const pad = mesh(fixing, m.navy);
      const at = polar(degrees, 2.7);
      pad.position.set(at.x, 0.545, -at.y);
      frame.add(pad);
    }
    this.add({ bom: 'HX6-BASE', node: frame, rest: v(0, 0, 0), explode: v(0, 0, 0), present: always }, this.root);

    const deck = mesh(hexPrism(2.28, 0.2), m.deck);
    this.add({ bom: 'HX6-BASE', node: deck, rest: v(0, 0.16, 0), explode: v(0, 0.55, 0), present: always }, this.root);

    const slewRing = mesh(new CylinderGeometry(1.16, 1.2, 0.18, 64), m.navy);
    this.add({ bom: 'HX6-BASE', node: slewRing, rest: v(0, 0.45, 0), explode: v(0, 1.0, 0), present: always }, this.root);

    // ---- upper structure
    const house = new Group();
    const body = mesh(new RoundedBoxGeometry(2.3, 0.92, 1.5, 5, 0.14), m.white);
    body.position.set(-0.25, 0, 0);
    const shoulder = mesh(new RoundedBoxGeometry(0.62, 0.5, 0.74, 4, 0.1), m.navy);
    shoulder.position.set(0.5, 0.62, 0);
    // glazing along the operator's side: a dark band set into the body
    const glazing = mesh(new RoundedBoxGeometry(0.86, 0.3, 0.06, 2, 0.03), m.navy);
    glazing.position.set(0.3, 0.14, 0.75);
    const glazingFront = mesh(new RoundedBoxGeometry(0.06, 0.3, 0.5, 2, 0.03), m.navy);
    glazingFront.position.set(0.9, 0.14, 0.42);
    house.add(body, shoulder, glazing, glazingFront);
    this.add({ bom: 'HX6-BASE', node: house, rest: v(0, 1.02, 0), explode: v(0, 1.55, 0), present: always });

    // Arm: an inner capsule that is always present, and an extension whose length is driven
    // by the reach spring. Their end caps coincide, so together they read as one bar.
    const inner = mesh(new CapsuleGeometry(ARM_R, ARM_STD - ARM_START, 10, 32), m.magenta);
    inner.rotation.z = Math.PI / 2;
    const innerNode = new Group();
    innerNode.add(inner);
    inner.position.x = (ARM_STD + ARM_START) / 2;
    // collars where the arm leaves the shoulder and where the tool hangs
    const collarGeometry = new CylinderGeometry(ARM_R + 0.045, ARM_R + 0.045, 0.2, 32);
    for (const x of [1.0, ARM_STD - 0.42]) {
      const collar = mesh(collarGeometry, m.navy);
      collar.rotation.z = Math.PI / 2;
      collar.position.x = x;
      innerNode.add(collar);
    }
    this.add({ bom: 'HX6-BASE', node: innerNode, rest: v(0, ARM_Y, 0), explode: v(0, 2.5, 0), present: always });

    const extension = new Group();
    this.armExtension = mesh(new CylinderGeometry(ARM_R, ARM_R, 1, 32, 1, true), m.magenta);
    this.armExtension.rotation.z = Math.PI / 2;
    this.armTip = mesh(new SphereGeometry(ARM_R, 32, 20), m.magenta);
    const armJoint = mesh(new SphereGeometry(ARM_R, 32, 20), m.magenta);
    armJoint.position.x = ARM_STD;
    extension.add(this.armExtension, this.armTip, armJoint);
    this.add({
      bom: 'HX6-ARM-14',
      node: extension,
      rest: v(0, ARM_Y, 0),
      explode: v(1.15, 2.5, 0),
      present: (e) => e.selection.reach === 'long',
    });

    this.hanger = mesh(new CylinderGeometry(0.045, 0.045, 0.62, 12), m.frame);
    this.add({ bom: 'HX6-BASE', node: this.hanger, rest: v(ARM_STD, ARM_Y - 0.5, 0), explode: v(0, 2.5, 0), present: always, followsTip: true });

    // ---- tools: the dots, each modelled as the tool it is named after, so the choice
    // changes the silhouette. Every head tops out where the hanger rod ends, and its
    // jaws, pad or bowl face the camera side-on because they lie along the arm.
    const toolCollar = new CylinderGeometry(0.2, 0.2, 0.1, 24);

    // gripper: a compact body carrying two opposed jaws that close towards each other
    const gripper = new Group();
    const gripperBody = mesh(new RoundedBoxGeometry(1.06, 0.34, 0.52, 4, 0.1), m.cyan);
    gripperBody.position.y = 0.19;
    const jawProfile = [
      new Vector2(0.27, 0.08),
      new Vector2(0.51, 0.08),
      new Vector2(0.58, -0.26),
      new Vector2(0.35, -0.51),
      new Vector2(0.19, -0.51),
      new Vector2(0.19, -0.39),
      new Vector2(0.36, -0.21),
    ];
    const jawRight = mesh(extrudeUpright(roundedShape(jawProfile, 0.07), 0.32), m.cyan);
    const jawLeft = mesh(
      extrudeUpright(
        roundedShape(
          jawProfile.map((p) => new Vector2(-p.x, p.y)),
          0.07,
        ),
        0.32,
      ),
      m.cyan,
    );
    gripper.add(gripperBody, jawRight, jawLeft);
    // the pins the jaws turn on show as two dark points on the body
    const pinGeometry = new CylinderGeometry(0.075, 0.075, 0.56, 16);
    for (const x of [-0.36, 0.36]) {
      const pin = mesh(pinGeometry, m.navy);
      pin.rotation.x = Math.PI / 2;
      pin.position.set(x, 0.17, 0);
      gripper.add(pin);
    }
    const gripperCollar = mesh(toolCollar, m.navy);
    gripperCollar.position.y = 0.4;
    gripper.add(gripperCollar);
    this.add({
      bom: 'HX6-TL-GRP',
      node: gripper,
      rest: v(ARM_STD, ARM_Y - 1.2, 0),
      explode: v(0.6, 1.25, 0),
      present: (e) => e.selection.tool === 'gripper',
      followsTip: true,
    });

    // vacuum lifter: a wide, flat suction pad under a short bellows
    const vacuum = new Group();
    const padLip = mesh(new CylinderGeometry(0.7, 0.7, 0.08, 48), m.orange);
    padLip.position.y = -0.31;
    const padCup = mesh(new CylinderGeometry(0.4, 0.66, 0.13, 48), m.orange);
    padCup.position.y = -0.205;
    const bellowsCore = mesh(new CylinderGeometry(0.17, 0.17, 0.42, 24), m.navy);
    bellowsCore.position.y = 0.05;
    vacuum.add(padLip, padCup, bellowsCore);
    const foldGeometry = new TorusGeometry(0.19, 0.055, 10, 32);
    for (const y of [-0.07, 0.06, 0.19]) {
      const fold = mesh(foldGeometry, m.orange);
      fold.rotation.x = Math.PI / 2;
      fold.position.y = y;
      vacuum.add(fold);
    }
    const vacuumCollar = mesh(toolCollar, m.navy);
    vacuumCollar.position.y = 0.3;
    vacuum.add(vacuumCollar);
    this.add({
      bom: 'HX6-TL-VAC',
      node: vacuum,
      rest: v(ARM_STD, ARM_Y - 1.13, 0),
      explode: v(0.6, 1.25, 0),
      present: (e) => e.selection.tool === 'vacuum',
      followsTip: true,
    });

    // hook: a block with its pin, a shank, and a bowl that opens upwards to one side.
    // The bowl is centred under the block, the way a load hook hangs.
    const hook = new Group();
    const bowlR = 0.24;
    const tubeR = 0.08;
    const bowlFrom = (140 * Math.PI) / 180;
    const bowlSweep = Math.PI * 1.42;
    const hookArc = mesh(new TorusGeometry(bowlR, tubeR, 14, 40, bowlSweep), m.frame);
    hookArc.rotation.z = bowlFrom;
    // rounded ends: one closes the tip, one hides the joint between bowl and shank
    const endGeometry = new SphereGeometry(tubeR, 16, 12);
    const tip = mesh(endGeometry, m.frame);
    tip.position.set(Math.cos(bowlFrom + bowlSweep) * bowlR, Math.sin(bowlFrom + bowlSweep) * bowlR, 0);
    const joint = mesh(endGeometry, m.frame);
    joint.position.set(Math.cos(bowlFrom) * bowlR, Math.sin(bowlFrom) * bowlR, 0);
    // the shank leaves the bowl along its tangent and meets the block on the centre line
    const shankLength = -joint.position.x / Math.sin(bowlFrom);
    const shank = mesh(new CylinderGeometry(tubeR, tubeR, shankLength, 14), m.frame);
    shank.rotation.z = bowlFrom - Math.PI;
    shank.position.set(joint.position.x / 2, joint.position.y - (Math.cos(bowlFrom) * shankLength) / 2, 0);
    const hookBlock = mesh(new RoundedBoxGeometry(0.44, 0.32, 0.3, 3, 0.08), m.frame);
    hookBlock.position.y = 0.51;
    const hookPin = mesh(new CylinderGeometry(0.085, 0.085, 0.34, 16), m.navy);
    hookPin.rotation.x = Math.PI / 2;
    hookPin.position.y = 0.51;
    hook.add(hookArc, tip, joint, shank, hookBlock, hookPin);
    this.add({
      bom: 'HX6-TL-HOK',
      node: hook,
      rest: v(ARM_STD, ARM_Y - 1.45, 0),
      explode: v(0.6, 1.25, 0),
      present: (e) => e.selection.tool === 'hook',
      followsTip: true,
    });

    // ---- ballast
    const ballastGeometry = new RoundedBoxGeometry(0.66, 0.5, 1.34, 4, 0.09);
    this.add({ bom: 'HX6-BASE', node: mesh(ballastGeometry, m.navy), rest: v(-1.78, 0.86, 0), explode: v(-0.75, 1.55, 0), present: always });
    this.add({
      bom: 'HX6-BAL-01',
      node: mesh(ballastGeometry, m.navy),
      rest: v(-1.78, 1.4, 0),
      explode: v(-1.5, 2.3, 0),
      present: (e) => e.ballastBlocks > 1,
    });

    // ---- power
    const diesel = new Group();
    diesel.add(mesh(new RoundedBoxGeometry(0.92, 0.3, 1.02, 3, 0.07), m.bone));
    const stack = mesh(new CylinderGeometry(0.075, 0.075, 0.56, 16), m.frame);
    stack.position.set(-0.28, 0.4, -0.3);
    diesel.add(stack);
    this.add({
      bom: 'HX6-BASE',
      node: diesel,
      rest: v(-0.78, 1.63, 0),
      explode: v(0, 2.35, 0),
      present: (e) => e.selection.power === 'diesel',
    });

    const electric = new Group();
    electric.add(mesh(new RoundedBoxGeometry(0.92, 0.26, 1.02, 3, 0.07), m.white));
    const cell = mesh(new RoundedBoxGeometry(0.74, 0.08, 0.84, 2, 0.03), m.cyan);
    cell.position.y = 0.16;
    electric.add(cell);
    this.add({
      bom: 'HX6-PWR-E',
      node: electric,
      rest: v(-0.78, 1.61, 0),
      explode: v(0, 3.0, 0),
      present: (e) => e.selection.power === 'electric',
    });

    // ---- vacuum pump kit rides on the deck, beside the house
    const pump = new Group();
    pump.add(mesh(new RoundedBoxGeometry(0.86, 0.46, 0.5, 3, 0.07), m.bone));
    const band = mesh(new RoundedBoxGeometry(0.88, 0.1, 0.52, 2, 0.03), m.orange);
    band.position.y = 0.1;
    pump.add(band);
    this.add(
      {
        bom: 'HX6-PMP-KIT',
        node: pump,
        rest: v(-0.3, 0.6, 1.32),
        explode: v(0, 0.75, 1.3),
        present: (e) => e.pumpKit,
      },
      this.root,
    );

    // ---- working radius drawn on the ground, the way a load chart shows it
    this.reachArc = mesh(new RingGeometry(0.985, 1.0, 96, 1, -0.62, 1.24), this.arcMaterial);
    this.reachArc.rotation.x = -Math.PI / 2;
    this.reachArc.position.y = 0.012;
    this.reachArc.renderOrder = 1;
    this.root.add(this.reachArc);

    // ---- label anchors
    const anchor = (name: string, parent: Object3D, x: number, y: number, z: number) => {
      const node = new Object3D();
      node.position.set(x, y, z);
      parent.add(node);
      this.anchors.set(name, node);
    };
    anchor('frame', this.root, -2.6, 0.5, 1.5);
    anchor('arm', this.upper, 2.6, ARM_Y + 0.3, 0);
    anchor('tool', this.upper, ARM_STD, ARM_Y - 1.2, 0);
    anchor('ballast', this.upper, -1.78, 1.7, 0);
    anchor('power', this.upper, -0.78, 1.85, 0);
    anchor('reach', this.root, ARM_STD, 0, 0);
  }

  apply(evaluation: Evaluation) {
    this.evaluation = evaluation;
    this.reach.target = evaluation.selection.reach === 'long' ? ARM_LONG : ARM_STD;
  }

  /** 0 = assembled, 1 = exploded into its bill of materials. */
  setExplode(amount: number) {
    this.explodeAmount.target = amount;
  }

  setSlew(radians: number) {
    this.slew.target = radians;
  }

  setArc(opacity: number) {
    this.arcOpacity.target = opacity;
  }

  snap() {
    this.reach.snap();
    this.explodeAmount.snap();
    this.slew.snap();
    this.arcOpacity.snap();
    this.update(0, true);
  }

  /** World position of a named anchor, for HTML labels. */
  anchor(name: string, out: Vector3) {
    const node = this.anchors.get(name);
    if (!node) return out.set(0, 0, 0);
    return node.getWorldPosition(out);
  }

  /** World position of the centre of a bill-of-materials group in the current pose. */
  bomAnchor(bom: string, out: Vector3) {
    let count = 0;
    out.set(0, 0, 0);
    const tmp = new Vector3();
    for (const part of this.parts) {
      if (part.bom !== bom || part.scale.value < 0.5) continue;
      part.node.getWorldPosition(tmp);
      out.add(tmp);
      count++;
    }
    if (count) out.multiplyScalar(1 / count);
    return count > 0;
  }

  update(dt: number, snap = false): boolean {
    const e = this.evaluation;
    let active = false;
    const step = (spring: Spring) => {
      if (snap) spring.snap();
      else if (spring.step(dt)) active = true;
    };
    step(this.reach);
    step(this.explodeAmount);
    step(this.slew);
    step(this.arcOpacity);
    if (snap) this.intro = 1;
    else if (this.intro < 1) {
      this.intro = Math.min(1, this.intro + dt / 1.5);
      active = true;
    }

    const reach = this.reach.value;
    const explode = this.explodeAmount.value;
    const tipShift = reach - ARM_STD;

    this.upper.rotation.y = this.slew.value;

    // arm extension: cylinder from the standard tip to the current reach, capped by a sphere
    const extensionLength = Math.max(0.0001, reach - ARM_STD);
    this.armExtension.scale.set(1, extensionLength, 1);
    this.armExtension.position.x = ARM_STD + extensionLength / 2;
    this.armTip.position.x = ARM_STD + extensionLength;

    for (const part of this.parts) {
      const arrived = this.intro >= part.order * 0.86;
      const present = (e ? part.present(e) : true) && arrived;
      part.scale.target = present ? 1 : 0;
      const follow = part.followsTip ? tipShift : 0;
      // the extension carries the tools outward with it when the unit is exploded
      const explodeX = part.followsTip && e?.selection.reach === 'long' ? part.explode.x + 1.15 : part.explode.x;
      part.x.target = part.rest.x + follow + explodeX * explode;
      part.y.target = part.rest.y + part.explode.y * explode + (arrived ? 0 : 1.6);
      part.z.target = part.rest.z + part.explode.z * explode;
      step(part.x);
      step(part.y);
      step(part.z);
      step(part.scale);
      const s = Math.max(0, part.scale.value);
      part.node.visible = s > 0.002;
      if (part.bom === 'HX6-ARM-14') {
        // the extension telescopes; it is hidden by length, not by scale
        part.node.scale.setScalar(1);
        part.node.visible = extensionLength > 0.01 && arrived;
      } else {
        part.node.scale.setScalar(s);
      }
      part.node.position.set(part.x.value, part.y.value, part.z.value);
    }

    // working radius follows the reach
    this.reachArc.scale.setScalar(reach);
    this.arcMaterial.opacity = Math.max(0, this.arcOpacity.value) * 0.55;
    this.reachArc.visible = this.arcMaterial.opacity > 0.004;
    const reachAnchor = this.anchors.get('reach');
    if (reachAnchor) reachAnchor.position.set(reach * Math.cos(0.62), 0, reach * Math.sin(0.62));
    const toolAnchor = this.anchors.get('tool');
    if (toolAnchor) toolAnchor.position.x = reach;

    return active;
  }
}
