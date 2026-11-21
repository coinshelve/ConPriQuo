/**
 * Minimal damped spring. Every animated quantity in the scene is a spring that chases
 * a target, so scroll scrubbing, option changes and interruptions all blend without
 * any timeline bookkeeping.
 */
export class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(
    initial: number,
    private stiffness = 150,
    private damping = 24,
  ) {
    this.value = initial;
    this.target = initial;
  }

  /** Advance by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    const d = this.target - this.value;
    if (Math.abs(d) < 0.0004 && Math.abs(this.velocity) < 0.0004) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    // semi-implicit Euler in small sub-steps keeps stiff springs stable on slow frames
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return true;
  }

  snap(to = this.target) {
    this.target = to;
    this.value = to;
    this.velocity = 0;
  }
}

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of t through [a, b], clamped to 0..1. */
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
