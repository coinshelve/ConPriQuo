import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  LineSegments,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
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
 * The floor of the stage: the logo's hexagon, tiled. Every scene stands on it, and
 * the machine's frame fills exactly one cell. The lines are strongest under whatever
 * the camera is looking at and fade to nothing before the edge of the canvas, so the
 * lattice never ends in a cut line, whatever the size or shape of the stage.
 */
function createLattice(): LineSegments {
  const cell = 3.55;
  const reach = 8;
  const positions: number[] = [];
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const cx = 1.5 * cell * i;
      const cz = Math.sqrt(3) * cell * (j + (Math.abs(i) % 2 ? 0.5 : 0));
      // three edges per cell are enough: the neighbours draw the other three
      for (let k = 0; k < 3; k++) {
        const a = (Math.PI / 3) * k;
        const b = (Math.PI / 3) * (k + 1);
        positions.push(cx + cell * Math.cos(a), 0, cz + cell * Math.sin(a));
        positions.push(cx + cell * Math.cos(b), 0, cz + cell * Math.sin(b));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new Color(BRAND.lattice) } },
    vertexShader: /* glsl */ `
      varying vec2 vScreen;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vScreen = clip.xy / clip.w;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vScreen;
      void main() {
        // 0 at the centre of the canvas, 1 at the middle of each edge
        float edge = length(vScreen);
        float alpha = 1.0 - smoothstep(0.46, 1.0, edge);
        gl_FragColor = vec4(uColor, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const lattice = new LineSegments(geometry, material);
  lattice.position.y = 0.006;
  lattice.renderOrder = -1;
  lattice.frustumCulled = false;
  return lattice;
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
  private ratio = 0;
  private visible = false;
  private started = false;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private callbacks: FrameCallback[] = [];
  private resizeCallbacks: (() => void)[] = [];
  private lostCallbacks: (() => void)[] = [];
  private lostTimer = 0;
  private disposed = false;
  private lost = false;
  private pose: CameraPose = { tx: 0, ty: 0, tz: 0, fitH: 10, fitW: 10, az: Math.PI / 4, el: 0.56 };
  private parallaxX = new Spring(0, 60, 16);
  private parallaxY = new Spring(0, 60, 16);
  private target = new Vector3();
  private scratch = new Vector3();
  private lightDir = new Vector3(...LIGHT_DIR).normalize();

  constructor(private options: RigOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.className = 'stage-canvas';

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      // Software rendering is refused: those devices are served the posters instead.
      failIfMajorPerformanceCaveat: true,
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

    // The page's navy shows through the canvas; only the shadow is drawn on the ground.
    const ground = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ color: BRAND.shadow, opacity: 0.5 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground, createLattice());

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
      this.lost = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      // If the browser does not hand the context back shortly, the caller falls back.
      this.lostTimer = window.setTimeout(() => {
        if (this.lost) for (const callback of this.lostCallbacks) callback();
      }, 2500);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      window.clearTimeout(this.lostTimer);
      this.invalidate();
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
  }

  private onVisibility = () => {
    if (!document.hidden) this.invalidate();
  };

  private onPointer = (event: PointerEvent) => {
    if (this.options.reducedMotion || event.pointerType === 'touch' || !this.slot || !this.visible) return;
    this.parallaxX.target = (event.clientX / window.innerWidth - 0.5) * 2;
    this.parallaxY.target = (event.clientY / window.innerHeight - 0.5) * 2;
    this.invalidate();
  };

  /** Applies the capped device pixel ratio. Returns true when it changed. */
  private applyPixelRatio(): boolean {
    const cap = this.options.lowPower ? 1.5 : 2;
    const ratio = Math.min(window.devicePixelRatio || 1, cap);
    if (ratio === this.ratio) return false;
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    return true;
  }

  /** Move the canvas into a slot element and size it to that element. */
  mount(slot: HTMLElement) {
    if (this.disposed || this.slot === slot) return;
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
    if (!this.slot || this.disposed) return;
    const w = Math.max(1, Math.round(this.slot.clientWidth));
    const h = Math.max(1, Math.round(this.slot.clientHeight));
    const ratioChanged = this.applyPixelRatio();
    if (w === this.width && h === this.height && !ratioChanged) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    for (const callback of this.resizeCallbacks) callback();
    // Resizing clears the drawing buffer. Draw again at once so the stage never
    // shows an empty frame while a window edge is being dragged.
    if (this.started && !this.lost) {
      this.applyCamera();
      this.renderer.render(this.scene, this.camera);
    }
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

  /** Called whenever the slot changes size, before the next frame. */
  onResize(callback: () => void) {
    this.resizeCallbacks.push(callback);
  }

  /** Called if the graphics context is lost and not restored. */
  onLost(callback: () => void) {
    this.lostCallbacks.push(callback);
  }

  /** Nothing is drawn until start() is called, so shaders can be compiled first. */
  start() {
    this.started = true;
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
    if (!this.started || this.raf || this.disposed || this.lost) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.lost) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;

    // Nothing on screen: stop until the slot becomes visible again.
    if (!this.visible || document.hidden) return;

    this.dirty = false;
    let active = false;
    if (this.parallaxX.step(dt)) active = true;
    if (this.parallaxY.step(dt)) active = true;
    // The camera is settled first, so call-outs placed by the callbacks are projected
    // with the same view the frame is drawn with.
    this.applyCamera();
    for (const callback of this.callbacks) if (callback(dt, now / 1000)) active = true;
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
    this.camera.updateMatrixWorld();

    // Keep the shadow frustum centred on what the camera is looking at.
    this.key.target.position.set(pose.tx, 0, pose.tz);
    this.key.position.copy(this.key.target.position).addScaledVector(this.lightDir, 60);
  }

  /** Project a world point to CSS pixels inside the slot. */
  project(point: Vector3, out: { x: number; y: number }) {
    const v = this.scratch.copy(point).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    return out;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.lostTimer);
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointer);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
