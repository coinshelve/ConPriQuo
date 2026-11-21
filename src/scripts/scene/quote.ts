import { CapsuleGeometry, CylinderGeometry, Group, Mesh, Object3D, TorusGeometry, Vector3 } from 'three';
import type { BufferGeometry, Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Evaluation } from '../cpq/engine';
import { CATALOG } from '../cpq/engine';
import type { Materials } from './palette';
import { Spring, clamp01 } from './spring';
import { extrudeFlat, openHexShape } from './unit';

/**
 * The quote as an object. A sheet lies on the ground; each bill-of-materials line is a
 * printed row; the total is the logo's magenta bar; the approval is a stamp. In the
 * hand-off state the rows leave the sheet as packets and travel to two systems: one
 * summary record to CRM, every line to ERP.
 */
const SHEET_W = 5.2;
const SHEET_D = 7.0;
const ROW_Z0 = -1.15;
const ROW_STEP = 0.56;
const SHEET_Y = 0.07;

const PART_MATERIAL: Record<string, keyof Materials> = {
  'HX6-BASE': 'navy',
  'HX6-ARM-14': 'magenta',
  'HX6-BAL-01': 'navy',
  'HX6-TL-GRP': 'cyan',
  'HX6-TL-VAC': 'orange',
  'HX6-TL-HOK': 'navy',
  'HX6-PMP-KIT': 'orange',
  'HX6-PWR-E': 'cyan',
};

function mesh(geometry: BufferGeometry, material: Material, shadow = true) {
  const m = new Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

interface Row {
  part: string;
  node: Group;
  reveal: Spring;
  slot: Spring;
}

interface Packet {
  node: Mesh;
  /** 0 for the CRM track, 1 for the ERP track. */
  track: 0 | 1;
  offset: number;
}

export class Quote {
  readonly root = new Group();
  /** Where the miniature machine stands, in the sheet's own coordinates. */
  private figureLocal = new Vector3(-1.2, SHEET_Y, -2.35);
  private sheet: Group;
  private rows: Row[] = [];
  private stampCyan: Mesh;
  private stampOrange: Mesh;
  private stampDrop = new Spring(0, 240, 17);
  private totalBar: Mesh;
  private systems = new Group();
  private packets: Packet[] = [];
  private presence = new Spring(0, 80, 18);
  private handoff = new Spring(0, 60, 16);
  private evaluation: Evaluation | null = null;
  private anchors = new Map<string, Object3D>();
  private clock = 0;

  constructor(materials: Materials) {
    const m = materials;
    this.sheet = new Group();
    this.root.add(this.sheet);

    const paper = mesh(new RoundedBoxGeometry(SHEET_W, 0.07, SHEET_D, 2, 0.03), m.white);
    paper.position.y = 0.035;
    this.sheet.add(paper);

    // header: two short strips where the reference and dates sit on the HTML document
    const strip = (w: number, x: number, z: number, material: Material, d = 0.14) => {
      const s = mesh(new RoundedBoxGeometry(w, 0.035, d, 1, 0.012), material, false);
      s.position.set(x, SHEET_Y + 0.012, z);
      return s;
    };
    this.sheet.add(strip(1.5, 1.45, -2.95, m.navy, 0.2));
    this.sheet.add(strip(1.0, 1.7, -2.6, m.bone));
    this.sheet.add(strip(0.8, 1.8, -2.32, m.bone));
    // the magenta tab at the head of the sheet, as on the HTML document
    this.sheet.add(strip(0.95, -1.85, -SHEET_D / 2 + 0.1, m.magenta, 0.18));

    // rows: one per catalogue part; only those on the bill of materials are shown
    for (const item of CATALOG) {
      const node = new Group();
      const chip = mesh(new RoundedBoxGeometry(0.26, 0.05, 0.26, 2, 0.02), m[PART_MATERIAL[item.part]], false);
      chip.position.set(-2.1, 0.02, 0);
      const text = mesh(new RoundedBoxGeometry(2.3, 0.035, 0.13, 1, 0.012), m.navy, false);
      text.position.set(-0.6, 0.012, 0);
      const amount = mesh(new RoundedBoxGeometry(0.2 + (item.unitPrice / 186000) * 0.9, 0.035, 0.13, 1, 0.012), m.navy, false);
      amount.geometry.translate(-(0.2 + (item.unitPrice / 186000) * 0.9) / 2, 0, 0);
      amount.position.set(2.2, 0.012, 0);
      node.add(chip, text, amount);
      node.position.set(0, SHEET_Y, ROW_Z0);
      this.sheet.add(node);
      this.rows.push({ part: item.part, node, reveal: new Spring(0, 130, 20), slot: new Spring(0, 120, 21) });
    }

    // total: the bar
    const total = new CapsuleGeometry(0.11, 1.5, 6, 20);
    total.rotateZ(Math.PI / 2);
    this.totalBar = mesh(total, m.magenta);
    this.totalBar.position.set(1.35, SHEET_Y + 0.11, 2.85);
    this.sheet.add(this.totalBar);

    // approval stamp: cyan when within authority, orange while awaiting sign-off
    const stampGeometry = new CylinderGeometry(0.42, 0.42, 0.09, 48);
    this.stampCyan = mesh(stampGeometry, m.cyan);
    this.stampOrange = mesh(stampGeometry, m.orange);
    const ring = mesh(new TorusGeometry(0.42, 0.035, 10, 48), m.navy, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    const stamp = new Group();
    stamp.add(this.stampCyan, this.stampOrange, ring);
    stamp.position.set(-1.75, SHEET_Y + 0.045, 2.85);
    stamp.name = 'stamp';
    this.sheet.add(stamp);

    // ---- hand-off: two systems, drawn with the same open hexagon as the logo
    const hex = extrudeFlat(openHexShape(1.45, 0.3, 0.42, 0.14), 0.26, 0.04);
    hex.rotateY(Math.PI); // openings face back towards the sheet
    const deckGeometry = new CylinderGeometry(1.02, 1.02, 0.1, 6);
    const makeSystem = (z: number) => {
      const system = new Group();
      system.add(mesh(hex, m.navy));
      const deck = mesh(deckGeometry, m.bone, false);
      deck.position.y = 0.05;
      deck.rotation.y = Math.PI / 6;
      system.add(deck);
      system.position.set(6.3, 0, z);
      return system;
    };
    const crm = makeSystem(-2.5);
    const erp = makeSystem(2.5);
    this.systems.add(crm, erp);

    // tracks from the sheet to each system
    const track = (z: number) => {
      const t = mesh(new RoundedBoxGeometry(3.3, 0.03, 0.09, 1, 0.01), m.bone, false);
      t.position.set(3.25, 0.015, z);
      return t;
    };
    this.systems.add(track(-2.5), track(2.5));
    this.root.add(this.systems);

    const packetGeometry = new CapsuleGeometry(0.1, 0.5, 6, 16);
    packetGeometry.rotateZ(Math.PI / 2);
    const addPacket = (track: 0 | 1, offset: number) => {
      const node = mesh(packetGeometry, m.magenta);
      this.systems.add(node);
      this.packets.push({ node, track, offset });
    };
    addPacket(0, 0);
    for (let i = 0; i < 4; i++) addPacket(1, i / 4);

    const anchor = (name: string, parent: Object3D, x: number, y: number, z: number) => {
      const node = new Object3D();
      node.position.set(x, y, z);
      parent.add(node);
      this.anchors.set(name, node);
    };
    anchor('crm', this.root, 6.3, 0.5, -2.5);
    anchor('erp', this.root, 6.3, 0.5, 2.5);
    anchor('total', this.sheet, 2.1, 0.3, 2.85);
    anchor('stamp', this.sheet, -1.75, 0.35, 2.85);

    this.root.visible = false;
  }

  apply(evaluation: Evaluation) {
    this.evaluation = evaluation;
  }

  /** 0 hidden, 1 the sheet is laid out. */
  setPresence(amount: number) {
    this.presence.target = amount;
  }

  /** 0 quote only, 1 lines are leaving for CRM and ERP. */
  setHandoff(amount: number) {
    this.handoff.target = amount;
  }

  anchor(name: string, out: Vector3) {
    const node = this.anchors.get(name);
    if (!node) return out.set(0, 0, 0);
    return node.getWorldPosition(out);
  }

  /** World position of the spot on the sheet where the miniature machine stands. */
  figureWorld(out: Vector3) {
    this.sheet.updateWorldMatrix(true, false);
    return this.sheet.localToWorld(out.copy(this.figureLocal));
  }

  get handoffAmount() {
    return this.handoff.value;
  }

  snap() {
    this.presence.snap();
    this.handoff.snap();
    this.update(0, true, false);
  }

  update(dt: number, snap = false, animate = true): boolean {
    let active = false;
    const step = (spring: Spring) => {
      if (snap) spring.snap();
      else if (spring.step(dt)) active = true;
    };
    step(this.presence);
    step(this.handoff);
    const presence = clamp01(this.presence.value);
    const handoff = clamp01(this.handoff.value);

    this.root.visible = presence > 0.004;
    if (!this.root.visible) return active;

    // the sheet rises out of the ground plane as it arrives, and slides aside for the hand-off
    this.sheet.position.set(-handoff * 1.6, (presence - 1) * 0.5, 0);
    this.sheet.scale.setScalar(0.6 + presence * 0.4);

    const included = new Set(this.evaluation?.bom.map((line) => line.part) ?? []);
    let slot = 0;
    for (const row of this.rows) {
      const on = included.has(row.part);
      row.reveal.target = on && presence > 0.6 ? 1 : 0;
      row.slot.target = slot;
      if (on) slot++;
      step(row.reveal);
      step(row.slot);
      const r = clamp01(row.reveal.value);
      row.node.visible = r > 0.01;
      row.node.position.z = ROW_Z0 + row.slot.value * ROW_STEP;
      // rows print from the left edge
      row.node.scale.set(Math.max(0.001, r), 1, 1);
      row.node.position.x = -(1 - r) * 2.2;
    }

    // stamp: drops on once the sheet is laid out; colour follows the approval state
    const pending = Boolean(this.evaluation?.approvalRequired);
    this.stampCyan.visible = !pending;
    this.stampOrange.visible = pending;
    this.stampDrop.target = presence > 0.85 ? 1 : 0;
    step(this.stampDrop);
    const stamp = this.sheet.getObjectByName('stamp');
    if (stamp) {
      const d = this.stampDrop.value;
      stamp.visible = d > 0.01;
      stamp.position.y = SHEET_Y + 0.045 + Math.max(0, 1 - d) * 1.4;
      stamp.scale.setScalar(Math.max(0.001, Math.min(1.12, d)));
    }
    this.totalBar.scale.set(Math.max(0.001, presence), 1, 1);

    // systems and packets
    this.systems.visible = handoff > 0.01;
    if (this.systems.visible) {
      this.systems.scale.setScalar(0.7 + handoff * 0.3);
      this.systems.position.y = (handoff - 1) * 0.4;
      if (animate && !snap) {
        this.clock += dt;
        active = true;
      }
      for (const packet of this.packets) {
        const speed = packet.track === 0 ? 0.16 : 0.22;
        const t = (this.clock * speed + packet.offset) % 1;
        const z = packet.track === 0 ? -2.5 : 2.5;
        // leave the sheet edge, travel the track, and sink into the system's deck
        const x = 1.5 + t * 4.4;
        const fade = Math.min(1, t * 8) * Math.min(1, (1 - t) * 6);
        packet.node.position.set(x, 0.16, z);
        packet.node.scale.setScalar(Math.max(0.001, fade * handoff));
      }
    }
    return active;
  }
}
