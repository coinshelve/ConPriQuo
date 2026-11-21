import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { AMBIENT_RGB, BRAND, LIGHT_DIR, keyLightColor } from './palette';
import { Spring } from './spring';

export interface CameraPose {
  /** World point the camera looks at. */
  tx: number;
  ty: number;
  tz: number;
  /** World units that must fit vertically and horizontally inside the slot. */
  fitH: number;
  fitW: number;
  /** Azimuth and elevation in radians. */
  az: number;
  el: number;
}

export type FrameCallback = (dt: number, time: number) => boolean | void;

export interface RigOptions {
  /** Lower shadow resolution and pixel ratio for constrained devices. */
  lowPower: boolean;
  reducedMotion: boolean;
}

/**
 * Owns the renderer, the orthographic camera, the calibrated light rig and an
 * on-demand render loop. The canvas lives inside a DOM "slot"; layout stays in CSS
 * and the rig simply fills whichever slot it is mounted in.
 */
export class Rig {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  readonly canvas: HTMLCanvasElement;
  readonly key: DirectionalLight;

  private slot: HTMLElement | null = null;
  private resizeObserver: ResizeObserver;
  private visibilityObserver: IntersectionObserver;
  private width = 1;
  private height = 1;
  private visible = false;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private callbacks: FrameCallback[] = [];
  private disposed = false;
  private pose: CameraPose = { tx: 0, ty: 0, tz: 0, fitH: 10, fitW: 10, az: Math.PI / 4, el: 0.56 };
  private parallaxX = new Spring(0, 60, 16);
  private parallaxY = new Spring(0, 60, 16);
  private target = new Vector3();
  private lightDir = new Vector3(...LIGHT_DIR).normalize();
  readonly lost: { value: boolean } = { value: false };

  constructor(private options: RigOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.className = 'stage-canvas';

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.applyPixelRatio();

    const ambient = new AmbientLight(new Color(...AMBIENT_RGB), Math.PI);
    this.key = new DirectionalLight(keyLightColor(), Math.PI);
    this.key.castShadow = true;
    const size = options.lowPower ? 1024 : 2048;
    this.key.shadow.mapSize.set(size, size);
    const cam = this.key.shadow.camera;
    cam.left = -15;
    cam.right = 15;
    cam.top = 15;
    cam.bottom = -15;
    cam.near = 1;
    cam.far = 120;
    this.key.shadow.radius = options.lowPower ? 3 : 4.5;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.035;
    this.scene.add(ambient, this.key, this.key.target);

    // The page background shows through the canvas; only the shadow is drawn on the ground.
    const ground = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ color: BRAND.navy, opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.visible = entry.isIntersecting;
        if (this.visible) this.invalidate();
      },
      { rootMargin: '10% 0px' },
    );

    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost.value = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost.value = false;
      this.invalidate();
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
  }

  private onVisibility = () => {
    if (!document.hidden) this.invalidate();
  };

  private onPointer = (event: PointerEvent) => {
    if (this.options.reducedMotion || event.pointerType === 'touch' || !this.slot) return;
    this.parallaxX.target = (event.clientX / window.innerWidth - 0.5) * 2;
    this.parallaxY.target = (event.clientY / window.innerHeight - 0.5) * 2;
    this.invalidate();
  };

  private applyPixelRatio() {
    const cap = this.options.lowPower ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  /** Move the canvas into a slot element and size it to that element. */
  mount(slot: HTMLElement) {
    if (this.slot === slot) return;
    if (this.slot) {
      this.resizeObserver.unobserve(this.slot);
      this.visibilityObserver.unobserve(this.slot);
    }
    this.slot = slot;
    slot.appendChild(this.canvas);
    this.resizeObserver.observe(slot);
    this.visibilityObserver.observe(slot);
    this.measure();
  }

  private measure() {
    if (!this.slot) return;
    const w = Math.max(1, Math.round(this.slot.clientWidth));
    const h = Math.max(1, Math.round(this.slot.clientHeight));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.applyPixelRatio();
    this.renderer.setSize(w, h, false);
    this.invalidate();
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  setPose(pose: CameraPose) {
    this.pose = pose;
    this.invalidate();
  }

  /** Register a per-frame callback. Return true from it to request another frame. */
  onFrame(callback: FrameCallback) {
    this.callbacks.push(callback);
  }

  invalidate() {
    this.dirty = true;
    if (!this.raf && !this.disposed && !this.lost.value) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.lost.value) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;

    if (!this.visible || document.hidden) {
      // Nothing on screen: stop until the slot becomes visible again.
      return;
    }

    this.dirty = false;
    let active = false;
    for (const callback of this.callbacks) if (callback(dt, now / 1000)) active = true;
    if (this.parallaxX.step(dt)) active = true;
    if (this.parallaxY.step(dt)) active = true;

    this.applyCamera();
    this.renderer.render(this.scene, this.camera);

    // A callback may have called invalidate() and already queued the next frame.
    if ((active || this.dirty) && !this.raf) this.raf = requestAnimationFrame(this.loop);
  };

  private applyCamera() {
    const { pose } = this;
    const aspect = this.width / this.height;
    // Guarantee both the required height and the required width fit inside the slot.
    const viewH = Math.max(pose.fitH, pose.fitW / aspect);
    const az = pose.az + this.parallaxX.value * 0.11;
    const el = pose.el - this.parallaxY.value * 0.035;
    const distance = 120;
    this.target.set(pose.tx, pose.ty, pose.tz);
    this.camera.position.set(
      this.target.x + distance * Math.cos(el) * Math.sin(az),
      this.target.y + distance * Math.sin(el),
      this.target.z + distance * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(this.target);
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.left = (-viewH * aspect) / 2;
    this.camera.right = (viewH * aspect) / 2;
    this.camera.updateProjectionMatrix();

    // Keep the shadow frustum centred on what the camera is looking at.
    this.key.target.position.set(pose.tx, 0, pose.tz);
    this.key.position.copy(this.key.target.position).addScaledVector(this.lightDir, 60);
  }

  /** Project a world point to CSS pixels inside the slot. */
  project(point: Vector3, out: { x: number; y: number }) {
    const v = point.clone().project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    return out;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointer);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
