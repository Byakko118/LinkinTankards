/**
 * Resolve-phase hop attacks.
 *
 * Every successful hop is a body strike: the attacker travels until its card silhouette
 * overlaps the target, and every impact FX is anchored on that shared overlap
 * (overlap glow, seam flash, impact star, sparks) and held by hit-stop.
 * FX are white-only; hops differ by path, pose and follow-through, not color.
 */
import { Container, Graphics } from 'pixi.js';
import type { CardType } from './rules';

export type HopId = 'GG' | 'GK' | 'KA' | 'KS' | 'AA' | 'AS' | 'SG' | 'SK';

/** Gallery entries for the animation tester (fantasy names from the research brief). */
export interface AttackGalleryItem {
  id: HopId | 'BREAK';
  from: CardType;
  to: CardType;
  name: string;
  blurb: string;
}

export const ATTACK_GALLERY: readonly AttackGalleryItem[] = [
  { id: 'GG', from: 'G', to: 'G', name: 'Shoulder Check', blurb: 'Flat face-to-face ram, target shoved along the ground' },
  { id: 'GK', from: 'G', to: 'K', name: 'Uppercut Launch', blurb: 'Low dash, rising hit under the target, launches it up' },
  { id: 'KA', from: 'K', to: 'A', name: 'Sky Hand-off', blurb: 'Diagonal glide into the low corner, target drifts on' },
  { id: 'KS', from: 'K', to: 'S', name: 'Meteor Pin', blurb: 'Self-launch, then steep hammer onto the upper corner' },
  { id: 'AA', from: 'A', to: 'A', name: 'Wing Clip', blurb: 'Fastest dart, single slash through the seam' },
  { id: 'AS', from: 'A', to: 'S', name: 'Dive Bomb', blurb: 'Climb, pitch, spear dive — target slammed to the floor' },
  { id: 'SG', from: 'S', to: 'G', name: 'Aftershock Plant', blurb: 'Drop beside the target, plant, double ground ring' },
  { id: 'SK', from: 'S', to: 'K', name: 'Rebound Spring', blurb: 'Land on top, coil both cards, spring the target up' },
  { id: 'BREAK', from: 'G', to: 'A', name: 'Break / Snap', blurb: 'Lunge falls short — the gap cracks, nothing lands' },
] as const;

export function hopIdFor(from: CardType, to: CardType): HopId | null {
  const key = `${from}${to}`;
  const map: Record<string, HopId> = {
    GG: 'GG',
    GK: 'GK',
    KA: 'KA',
    KS: 'KS',
    AA: 'AA',
    AS: 'AS',
    SG: 'SG',
    SK: 'SK',
  };
  return map[key] ?? null;
}

export interface AttackContext {
  attacker: Container;
  target: Container;
  /** Sits above both cards, in the same coordinate space as the cards' parent. */
  fxLayer: Container;
  groundY: number;
  airY: number;
  aborted: () => boolean;
  /** Offset the whole board (directional micro-shake); (0, 0) restores. */
  nudgeBoard: (dx: number, dy: number) => void;
}

// ——— Tuning hooks (tester A/B, capture scripts) ———

let globalTimeScale = 1;
let freezeAfterContactMs: number | null = null;
let freezeSkip = 0;

/** 1 = real time, 0.1 = 10× slow-mo. */
export function setAttackTimeScale(scale: number): void {
  globalTimeScale = Math.max(0, scale);
}

/**
 * Freeze a hop this many game-ms after its contact frame (null = off).
 * `skip` lets that many contacts play through first (to freeze the Nth hop of a chain).
 */
export function setAttackFreezeOnContact(ms: number | null, skip = 0): void {
  freezeAfterContactMs = ms;
  freezeSkip = skip;
}

// ——— Math ———

interface Vec {
  x: number;
  y: number;
}

interface Pose {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

interface Geom {
  hw: number;
  hh: number;
  r: number;
}

interface Hit {
  p: Vec;
  poly: Vec[];
}

const WHITE = 0xffffff;
const INK = 0x120c08;

function vec(x: number, y: number): Vec {
  return { x, y };
}

function norm(x: number, y: number): Vec {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function perp(v: Vec): Vec {
  return { x: -v.y, y: v.x };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  inCubic: (t: number) => t * t * t,
  outQuad: (t: number) => 1 - (1 - t) ** 2,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

type Ease = (t: number) => number;

/** Pose at an offset from a base position, with absolute rotation/scale. */
function at(base: Vec, dx = 0, dy = 0, rot = 0, sx = 1, sy = 1): Pose {
  return { x: base.x + dx, y: base.y + dy, rot, sx, sy };
}

function poseOf(c: Container): Pose {
  return { x: c.x, y: c.y, rot: c.rotation, sx: c.scale.x, sy: c.scale.y };
}

function setPose(c: Container, p: Pose): void {
  c.position.set(p.x, p.y);
  c.rotation = p.rot;
  c.scale.set(p.sx, p.sy);
}

function mixPose(a: Pose, b: Pose, e: number, ctrl?: Vec): Pose {
  let x: number;
  let y: number;
  if (ctrl) {
    const u = 1 - e;
    x = u * u * a.x + 2 * u * e * ctrl.x + e * e * b.x;
    y = u * u * a.y + 2 * u * e * ctrl.y + e * e * b.y;
  } else {
    x = lerp(a.x, b.x, e);
    y = lerp(a.y, b.y, e);
  }
  return { x, y, rot: lerp(a.rot, b.rot, e), sx: lerp(a.sx, b.sx, e), sy: lerp(a.sy, b.sy, e) };
}

function geomOf(c: Container): Geom {
  const b = c.getLocalBounds();
  const hw = Math.max(Math.abs(b.minX), Math.abs(b.maxX));
  const hh = Math.max(Math.abs(b.minY), Math.abs(b.maxY));
  return { hw, hh, r: Math.min(hw, hh) * 0.16 };
}

function corners(p: Pose, g: Geom): Vec[] {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const hw = g.hw * p.sx;
  const hh = g.hh * p.sy;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => ({ x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c }));
}

function signedArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function lineHit(p1: Vec, p2: Vec, a: Vec, b: Vec): Vec {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return p2;
  const t = ((a.x - p1.x) * d2y - (a.y - p1.y) * d2x) / den;
  return { x: p1.x + d1x * t, y: p1.y + d1y * t };
}

/** Sutherland–Hodgman: intersection of two convex polygons. */
function clipConvex(subject: Vec[], clip: Vec[]): Vec[] {
  const sign = Math.sign(signedArea(clip)) || 1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: Vec) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const ci = inside(cur);
      if (ci !== inside(prev)) out.push(lineHit(prev, cur, a, b));
      if (ci) out.push(cur);
    }
  }
  return out;
}

function centroid(poly: Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function flat(poly: Vec[]): number[] {
  return poly.flatMap((p) => [p.x, p.y]);
}

/** Leading point of a card along `d` (averages near-equal corners so flat faces lead from their middle). */
function support(p: Pose, g: Geom, d: Vec): Vec {
  const cs = corners(p, g);
  const dots = cs.map((c) => c.x * d.x + c.y * d.y);
  const max = Math.max(...dots);
  return centroid(cs.filter((_, i) => dots[i] >= max - g.hh * 0.35));
}

// ——— Scene: one hop's cards, clock and FX ———

/** Return false once finished. `t` is game-ms since spawn (slow-mo / freeze aware). */
type FxItem = (t: number, g: Graphics) => boolean;

interface Track {
  card: Container;
  to: Pose;
  ctrl?: Vec;
  ease?: Ease;
}

interface StrikeOpts {
  ease?: Ease;
  /** How far back along the final approach the bezier control sits (0 = straight line). */
  bend?: number;
  ctrl?: Vec;
}

class Scene {
  readonly A: Container;
  readonly T: Container;
  readonly ag: Geom;
  readonly tg: Geom;
  readonly a0: Pose;
  readonly t0: Pose;
  /** 1 at board card size. */
  readonly u: number;
  readonly laneGap: number;
  readonly ctx: AttackContext;

  private readonly fxG = new Graphics();
  private items: { t: number; fn: FxItem }[] = [];
  private cleanups: (() => void)[] = [];
  private fxRaf = 0;
  private fxLast = 0;
  private frozen = false;
  /** Cards handed back; world-space FX may still be fading. */
  private released = false;

  constructor(ctx: AttackContext) {
    this.ctx = ctx;
    this.A = ctx.attacker;
    this.T = ctx.target;
    this.ag = geomOf(this.A);
    this.tg = geomOf(this.T);
    this.a0 = { x: this.A.x, y: this.A.y, rot: 0, sx: 1, sy: 1 };
    this.t0 = { x: this.T.x, y: this.T.y, rot: 0, sx: 1, sy: 1 };
    setPose(this.A, this.a0);
    setPose(this.T, this.t0);
    this.u = this.tg.hh / 72;
    this.laneGap = Math.abs(ctx.groundY - ctx.airY) || this.tg.hh * 2;
    ctx.fxLayer.addChild(this.fxG);

    // The striker must draw over the card it hits.
    const parent = this.A.parent;
    if (parent) {
      const idx = parent.getChildIndex(this.A);
      parent.setChildIndex(this.A, parent.children.length - 1);
      this.cleanups.push(() => {
        if (this.A.parent === parent) parent.setChildIndex(this.A, Math.min(idx, parent.children.length - 1));
      });
    }
  }

  get aborted(): boolean {
    return this.released || this.ctx.aborted();
  }

  private scale(): number {
    return this.frozen ? 0 : globalTimeScale;
  }

  tween(ms: number, fn: (p: number, t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const step = (now: number) => {
        if (this.aborted) {
          resolve();
          return;
        }
        t += clamp(now - last, 0, 50) * this.scale();
        last = now;
        const p = ms <= 0 ? 1 : Math.min(1, t / ms);
        fn(p, t);
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async move(ms: number, tracks: Track[], onFrame?: (p: number) => void): Promise<void> {
    const starts = tracks.map((tr) => poseOf(tr.card));
    await this.tween(ms, (p) => {
      tracks.forEach((tr, i) => {
        setPose(tr.card, mixPose(starts[i], tr.to, (tr.ease ?? ease.outCubic)(p), tr.ctrl));
      });
      onFrame?.(p);
    });
  }

  /** Hit-stop: both cards hold their contact pose; the victim vibrates along the hit. */
  async hold(ms: number, shake?: { card: Container; dir: Vec; amp: number }): Promise<void> {
    const pa = poseOf(this.A);
    const pt = poseOf(this.T);
    await this.tween(ms, (p, t) => {
      setPose(this.A, pa);
      setPose(this.T, pt);
      if (shake) {
        const k = Math.floor(t / 20) % 2 === 0 ? 1 : -1;
        const a = shake.amp * (1 - p * 0.6) * k;
        shake.card.x += shake.dir.x * a;
        shake.card.y += shake.dir.y * a;
      }
    });
    if (!this.aborted) {
      setPose(this.A, pa);
      setPose(this.T, pt);
    }
  }

  /** Attacker pose whose silhouette just touches the target along `m`, pushed `ov` px in. */
  approach(aim: Vec, m: Vec, rot: number, sx: number, sy: number, ov: number): Pose {
    const tPoly = corners(this.t0, this.tg);
    const reach =
      2 * (Math.hypot(this.ag.hw * sx, this.ag.hh * sy) + Math.hypot(this.tg.hw, this.tg.hh));
    const poseAt = (s: number): Pose => ({
      x: aim.x - m.x * (reach - s),
      y: aim.y - m.y * (reach - s),
      rot,
      sx,
      sy,
    });
    const touching = (s: number) =>
      Math.abs(signedArea(clipConvex(corners(poseAt(s), this.ag), tPoly))) > 0.5;
    if (!touching(reach)) return poseAt(reach);
    let lo = 0;
    let hi = reach;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (touching(mid)) hi = mid;
      else lo = mid;
    }
    return poseAt(hi + ov);
  }

  /** Shared contact: the region where both card silhouettes overlap right now. */
  contact(): Hit {
    const poly = clipConvex(corners(poseOf(this.A), this.ag), corners(poseOf(this.T), this.tg));
    if (poly.length >= 3) return { p: centroid(poly), poly };
    const d = norm(this.T.x - this.A.x, this.T.y - this.A.y);
    const a = support(poseOf(this.A), this.ag, d);
    const b = support(poseOf(this.T), this.tg, vec(-d.x, -d.y));
    return { p: vec((a.x + b.x) / 2, (a.y + b.y) / 2), poly: [] };
  }

  /** Rotation impulse from an off-center hit (torque around the target center). */
  spin(p: Vec, dir: Vec, k: number): number {
    const rx = p.x - this.t0.x;
    const ry = p.y - this.t0.y;
    return (k * (rx * dir.y - ry * dir.x)) / Math.max(this.tg.hw, this.tg.hh);
  }

  /** Target pose squashed against the floor (bottom edge stays planted). */
  tLand(sx: number, sy: number, dx = 0, dy = 0): Pose {
    return at(this.t0, dx, dy + this.tg.hh * (1 - sy), 0, sx, sy);
  }

  /**
   * Fast travel into contact with a smear: tapered white ribbon + afterimages + speed lines
   * from the launch point to the card. Returns a release() that fades the smear (call after hit-stop).
   */
  async strike(ms: number, to: Pose, m: Vec, opts: StrikeOpts = {}): Promise<() => void> {
    const from = poseOf(this.A);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const bend = opts.bend ?? 0.4;
    const ctrl = opts.ctrl ?? vec(to.x - m.x * dist * bend, to.y - m.y * dist * bend);
    const easeFn = opts.ease ?? ease.inQuad;
    const path = (e: number) => mixPose(from, to, e, ctrl);

    const g = new Graphics();
    const parent = this.A.parent;
    if (parent) parent.addChildAt(g, parent.getChildIndex(this.A));
    else this.ctx.fxLayer.addChildAt(g, 0);
    this.cleanups.push(() => {
      if (!g.destroyed) g.destroy();
    });

    let head = 0;
    let releaseAsked = false;
    let releasedAt = -1;
    this.addFx((t) => {
      if (g.destroyed) return false;
      g.clear();
      let alpha = 1;
      if (releaseAsked) {
        if (releasedAt < 0) releasedAt = t;
        alpha = 1 - (t - releasedAt) / 130;
        if (alpha <= 0) return false;
      }
      drawSmear(g, path, head, this.ag, alpha, this.u);
      return true;
    });

    await this.move(ms, [{ card: this.A, to, ctrl, ease: easeFn }], (p) => {
      head = easeFn(p);
    });
    return () => {
      releaseAsked = true;
    };
  }

  // ——— FX clock ———

  addFx(fn: FxItem): void {
    if (this.aborted) return;
    fn(0, this.fxG);
    this.items.push({ t: 0, fn });
    if (!this.fxRaf) {
      this.fxLast = performance.now();
      this.fxRaf = requestAnimationFrame(this.fxTick);
    }
  }

  private fxTick = (now: number) => {
    this.fxRaf = 0;
    if (this.ctx.aborted() || this.fxG.destroyed) {
      this.killFx();
      return;
    }
    const dt = clamp(now - this.fxLast, 0, 50) * this.scale();
    this.fxLast = now;
    this.fxG.clear();
    this.items = this.items.filter((it) => {
      it.t += dt;
      return it.fn(it.t, this.fxG);
    });
    if (this.items.length) this.fxRaf = requestAnimationFrame(this.fxTick);
    else if (this.released) this.killFx();
  };

  private killFx(): void {
    if (this.fxRaf) cancelAnimationFrame(this.fxRaf);
    this.fxRaf = 0;
    this.items = [];
    if (!this.fxG.destroyed) this.fxG.destroy();
  }

  markContact(): void {
    if (freezeAfterContactMs === null) return;
    if (freezeSkip > 0) {
      freezeSkip -= 1;
      return;
    }
    const ms = freezeAfterContactMs;
    this.addFx((t) => {
      if (t < ms) return true;
      this.frozen = true;
      return false;
    });
  }

  /** Hand the cards back at their slots; dust/rings already in flight fade out on their own. */
  finish(): void {
    this.released = true;
    for (let i = this.cleanups.length - 1; i >= 0; i--) this.cleanups[i]();
    this.cleanups = [];
    if (!this.A.destroyed) setPose(this.A, this.a0);
    if (!this.T.destroyed) setPose(this.T, this.t0);
    this.ctx.nudgeBoard(0, 0);
    if (this.ctx.aborted() || !this.items.length) this.killFx();
  }

  // ——— Impact language (all white, anchored on the shared contact) ———

  /**
   * The contact frame. `m` = approach direction (sets the seam), `dir` = force direction
   * (sets sparks, star bias, shake). `weight` 0 = light keep … 1 = heavy lane change.
   */
  impact(hit: Hit, m: Vec, dir: Vec, weight: number, opts: { invert?: boolean } = {}): void {
    this.markContact();
    const { p, poly } = hit;
    const u = this.u;
    const w = weight;
    const seam = perp(m);

    if (poly.length >= 3) {
      const pts = flat(poly);
      const life = 100 + 60 * w;
      this.addFx((t, g) => {
        if (t >= life) return false;
        const a = t < 45 ? 1 : 1 - (t - 45) / (life - 45);
        g.poly(pts).fill({ color: WHITE, alpha: a });
        return true;
      });
    }

    let half = 0.4 * this.tg.hh;
    if (poly.length >= 3) {
      const proj = poly.map((v) => (v.x - p.x) * seam.x + (v.y - p.y) * seam.y);
      half = Math.max(half, (Math.max(...proj) - Math.min(...proj)) / 2 + 4 * u);
    }
    const seamLife = 130 + 70 * w;
    this.addFx((t, g) => {
      if (t >= seamLife) return false;
      const k = t / seamLife;
      const len = half * (1 + 0.15 * ease.outCubic(k));
      const width = (7 + 5 * w) * u * (1 - k) + 0.5;
      g.moveTo(p.x - seam.x * len, p.y - seam.y * len)
        .lineTo(p.x + seam.x * len, p.y + seam.y * len)
        .stroke({ width, color: WHITE, alpha: 1 - k * k, cap: 'round' });
      return true;
    });

    this.star(p, m, dir, w, !!opts.invert);
    this.shockArc(p, dir, (22 + 16 * w) * u, (70 + 60 * w) * u, 200 + 110 * w, (6 + 3 * w) * u, 0.95, 20);
    this.shockArc(p, dir, (14 + 10 * w) * u, (46 + 40 * w) * u, 170 + 90 * w, (4 + 2 * w) * u, 0.7, 55);
    this.sparks(p, dir, 6 + Math.round(8 * w), (0.6 + 0.6 * w) * u, 0.8, 180 + 90 * w);
    this.sparks(p, seam, 2, 0.5 * u, 0.25, 150);
    this.sparks(p, vec(-seam.x, -seam.y), 2, 0.5 * u, 0.25, 150);
    this.flash(this.T, this.tg, 1, 30 + 24 * w, 180 + 80 * w);
    this.flash(this.A, this.ag, 0.4, 16, 140);
    this.shake(dir, (2 + 5 * w) * u);
  }

  private star(p: Vec, m: Vec, dir: Vec, w: number, invert: boolean): void {
    const u = this.u;
    const R = (28 + 26 * w) * u;
    const seam = perp(m);
    const aSeam = Math.atan2(seam.y, seam.x);
    const arms = [
      { a: aSeam, l: 1.25 },
      { a: aSeam + Math.PI, l: 1.2 },
      { a: Math.atan2(dir.y, dir.x), l: 1.55 },
      { a: Math.atan2(-m.y, -m.x), l: 0.6 },
    ];
    for (let i = 0; i < 6; i++) {
      arms.push({ a: aSeam + (i + 0.5) * (Math.PI / 3) + rand(-0.25, 0.25), l: rand(0.42, 0.8) });
    }
    const TAU = Math.PI * 2;
    arms.forEach((arm) => (arm.a = ((arm.a % TAU) + TAU) % TAU));
    arms.sort((a, b) => a.a - b.a);
    const life = 130 + 80 * w;
    this.addFx((t, g) => {
      if (t >= life) return false;
      const s = t < 18 ? lerp(0.6, 1.15, t / 18) : lerp(1.15, 0.6, ease.inQuad((t - 18) / (life - 18)));
      const alpha = t < 70 ? 1 : 1 - (t - 70) / (life - 70);
      const pts: number[] = [];
      for (let i = 0; i < arms.length; i++) {
        const a = arms[i];
        const b = arms[(i + 1) % arms.length];
        const span = ((b.a - a.a + TAU) % TAU) || TAU;
        const mid = a.a + span / 2;
        pts.push(p.x + Math.cos(a.a) * R * a.l * s, p.y + Math.sin(a.a) * R * a.l * s);
        pts.push(p.x + Math.cos(mid) * R * 0.34 * s, p.y + Math.sin(mid) * R * 0.34 * s);
      }
      const inverted = invert && t < 36;
      g.poly(pts)
        .fill({ color: inverted ? INK : WHITE, alpha })
        .stroke({ width: 2.5 * u, color: inverted ? WHITE : INK, alpha: alpha * 0.9, join: 'miter' });
      if (!inverted && t < 70) g.circle(p.x, p.y, R * 0.2 * s).fill({ color: WHITE, alpha });
      return true;
    });
  }

  /** Shock front: an arc opening along the force, travelling into the target from the contact. */
  shockArc(p: Vec, dir: Vec, r0: number, r1: number, life: number, width: number, halfSpan: number, delay = 0): void {
    const a = Math.atan2(dir.y, dir.x);
    this.addFx((t, g) => {
      const tt = t - delay;
      if (tt >= life) return false;
      if (tt < 0) return true;
      const k = tt / life;
      const e = ease.outCubic(k);
      const r = lerp(r0, r1, e);
      const span = halfSpan * (1 - 0.35 * e);
      g.moveTo(p.x + Math.cos(a - span) * r, p.y + Math.sin(a - span) * r)
        .arc(p.x, p.y, r, a - span, a + span)
        .stroke({ width: width * (1 - k) + 0.6, color: WHITE, alpha: 1 - k * k, cap: 'round' });
      return true;
    });
  }

  ring(p: Vec, r0: number, r1: number, life: number, width: number, squash = 1, delay = 0): void {
    this.addFx((t, g) => {
      const tt = t - delay;
      if (tt >= life) return false;
      if (tt < 0) return true;
      const k = tt / life;
      const r = lerp(r0, r1, ease.outCubic(k));
      g.ellipse(p.x, p.y, r, r * squash).stroke({ width: width * (1 - k) + 0.6, color: WHITE, alpha: 1 - k });
      return true;
    });
  }

  sparks(p: Vec, dir: Vec, count: number, speed: number, spread: number, life: number): void {
    const u = this.u;
    const base = Math.atan2(dir.y, dir.x);
    const list = Array.from({ length: count }, () => {
      const a = base + rand(-spread, spread);
      return {
        dx: Math.cos(a),
        dy: Math.sin(a),
        v: speed * rand(0.6, 1.4),
        l: life * rand(0.6, 1),
        w: rand(1.6, 3.2) * u,
      };
    });
    this.addFx((t, g) => {
      let alive = false;
      for (const s of list) {
        if (t >= s.l) continue;
        alive = true;
        const k = t / s.l;
        const d = s.v * s.l * 0.5 * (1 - (1 - k) ** 2) + 8 * u;
        const tail = Math.max(0, d - s.v * 45 * (1 - k) - 4 * u);
        g.moveTo(p.x + s.dx * tail, p.y + s.dy * tail)
          .lineTo(p.x + s.dx * d, p.y + s.dy * d)
          .stroke({ width: s.w * (1 - k * 0.7), color: WHITE, alpha: 1 - k * k, cap: 'round' });
      }
      return alive;
    });
  }

  /** Whole-card white flash (child overlay so it follows the card's pose). */
  flash(card: Container, geom: Geom, peak: number, holdMs: number, fadeMs: number): void {
    if (this.aborted) return;
    const o = new Graphics();
    o.roundRect(-geom.hw, -geom.hh, geom.hw * 2, geom.hh * 2, geom.r).fill({ color: WHITE });
    o.alpha = peak;
    card.addChild(o);
    this.cleanups.push(() => {
      if (!o.destroyed) o.destroy();
    });
    this.addFx((t) => {
      if (o.destroyed) return false;
      if (t < holdMs) {
        o.alpha = peak;
        return true;
      }
      const k = (t - holdMs) / fadeMs;
      if (k >= 1) {
        o.visible = false;
        return false;
      }
      o.alpha = peak * (1 - k) ** 2;
      return true;
    });
  }

  /** Soft white dust puffs kicked along the floor line. side: -1 left, 1 right, 0 both. */
  dust(x: number, y: number, count: number, side: number, spread: number): void {
    const u = this.u;
    const list = Array.from({ length: count }, (_, i) => {
      const sx = side === 0 ? (i % 2 ? 1 : -1) : side;
      return {
        ox: rand(-spread, spread),
        vx: sx * rand(0.1, 0.32) * u,
        vy: -rand(0.02, 0.08) * u,
        r0: rand(3, 6) * u,
        l: rand(260, 420),
      };
    });
    this.addFx((t, g) => {
      let alive = false;
      for (const d of list) {
        if (t >= d.l) continue;
        alive = true;
        const k = t / d.l;
        const e = ease.outQuad(k);
        g.circle(x + d.ox + d.vx * d.l * e, y + d.vy * d.l * e, d.r0 * (1 + 1.7 * e)).fill({
          color: WHITE,
          alpha: 0.5 * (1 - k),
        });
      }
      return alive;
    });
  }

  shake(dir: Vec, amp: number): void {
    const steps: [number, number][] = [
      [0, 1],
      [40, -0.55],
      [80, 0.25],
      [120, 0],
    ];
    let i = 0;
    this.addFx((t) => {
      while (i < steps.length && t >= steps[i][0]) {
        const k = steps[i][1];
        this.ctx.nudgeBoard(dir.x * amp * k, dir.y * amp * k);
        i++;
      }
      return i < steps.length;
    });
  }

  /** Thin crescent swipe through `p` (wipes in, then thins out). */
  slash(p: Vec, ang: number, len: number, thick: number, life: number, delay = 0, bulge = 0.18): void {
    const d = vec(Math.cos(ang), Math.sin(ang));
    const n = perp(d);
    const a = vec(p.x - (d.x * len) / 2, p.y - (d.y * len) / 2);
    this.addFx((t, g) => {
      const tt = t - delay;
      if (tt >= life) return false;
      if (tt < 0) return true;
      const wipe = Math.min(1, tt / 40);
      const k = tt / life;
      const L = len * wipe;
      const b = vec(a.x + d.x * L, a.y + d.y * L);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const th = thick * (1 - k * 0.8);
      g.moveTo(a.x, a.y)
        .quadraticCurveTo(mx + n.x * bulge * L * 2, my + n.y * bulge * L * 2, b.x, b.y)
        .quadraticCurveTo(mx + n.x * (bulge * L * 2 - th), my + n.y * (bulge * L * 2 - th), a.x, a.y)
        .fill({ color: WHITE, alpha: 1 - k * k });
      return true;
    });
  }

  /** Jagged fracture lines punched into the target from the contact point. */
  cracks(p: Vec, dir: Vec, count: number, len: number): void {
    const u = this.u;
    const base = Math.atan2(dir.y, dir.x);
    const lines = Array.from({ length: count }, (_, i) => {
      let a = base + (i - (count - 1) / 2) * 0.6;
      let cur = p;
      const pts = [cur];
      for (let s = 0; s < 4; s++) {
        a += rand(-0.45, 0.45);
        const l = (len / 4) * rand(0.7, 1.3);
        cur = vec(cur.x + Math.cos(a) * l, cur.y + Math.sin(a) * l);
        pts.push(cur);
      }
      return pts;
    });
    const life = 340;
    this.addFx((t, g) => {
      if (t >= life) return false;
      const k = t / life;
      const grow = Math.min(1, t / 40);
      for (const pts of lines) {
        const n = Math.max(1, Math.ceil(grow * (pts.length - 1)));
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= n; i++) g.lineTo(pts[i].x, pts[i].y);
        g.stroke({ width: 3 * u * (1 - k * 0.6), color: WHITE, alpha: 1 - k * k, join: 'miter' });
      }
      return true;
    });
  }

  /** Stacked chevrons shooting upward from under the target (spring release). */
  chevrons(x: number, y: number, count: number, life: number): void {
    const u = this.u;
    this.addFx((t, g) => {
      if (t >= life) return false;
      const k = t / life;
      for (let i = 0; i < count; i++) {
        const kk = clamp(k * 1.5 - i * 0.2, 0, 1);
        if (kk <= 0 || kk >= 1) continue;
        const cy = y - kk * 70 * u;
        const hw = (26 - i * 4) * u;
        g.moveTo(x - hw, cy + 12 * u)
          .lineTo(x, cy)
          .lineTo(x + hw, cy + 12 * u)
          .stroke({ width: 3.5 * u, color: WHITE, alpha: 1 - kk, join: 'miter', cap: 'round' });
      }
      return true;
    });
  }

  /** Vertical coil lines either side of a compressing card. */
  coils(xs: number[], bottom: number, height: () => number, life: number): void {
    const u = this.u;
    this.addFx((t, g) => {
      if (t >= life) return false;
      const k = t / life;
      const h = height();
      const turns = 5;
      for (const x of xs) {
        g.moveTo(x, bottom);
        for (let i = 1; i <= turns * 2; i++) {
          g.lineTo(x + (i % 2 ? 6 : -6) * u, bottom - (h * i) / (turns * 2));
        }
        g.stroke({ width: 2.5 * u, color: WHITE, alpha: 0.9 * (1 - k), join: 'miter' });
      }
      return true;
    });
  }

  /** Break glyph: a jagged crack across the empty gap that splits and falls, plus ash. */
  snap(p: Vec, m: Vec, len: number): void {
    const u = this.u;
    const s = perp(m);
    const pts: Vec[] = [];
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const f = i / segs - 0.5;
      const j = i === 0 || i === segs ? 0 : (i % 2 ? 1 : -1) * rand(4, 8) * u;
      pts.push(vec(p.x + s.x * f * len * 2 + m.x * j, p.y + s.y * f * len * 2 + m.y * j));
    }
    const mid = Math.floor(segs / 2);
    const halves = [pts.slice(0, mid + 1), pts.slice(mid)];
    const life = 320;
    this.addFx((t, g) => {
      if (t >= life) return false;
      const k = t / life;
      const split = t < 50 ? 0 : (t - 50) / (life - 50);
      halves.forEach((half, hi) => {
        const sign = hi === 0 ? -1 : 1;
        const ox = s.x * sign * split * 10 * u;
        const oy = s.y * sign * split * 10 * u + split * split * 26 * u;
        g.moveTo(half[0].x + ox, half[0].y + oy);
        for (let i = 1; i < half.length; i++) g.lineTo(half[i].x + ox, half[i].y + oy);
        g.stroke({ width: (t < 50 ? 6 : 4) * u, color: WHITE, alpha: 1 - k * k, join: 'miter' });
      });
      if (t < 50) g.circle(p.x, p.y, 6 * u).fill({ color: WHITE, alpha: 1 });
      return true;
    });

    const ash = Array.from({ length: 14 }, () => ({
      ox: rand(-len, len) * 0.8,
      vx: rand(-0.04, 0.04) * u,
      g: rand(0.0006, 0.0012) * u,
      r: rand(1.4, 2.8) * u,
      l: rand(280, 460),
    }));
    this.addFx((t, g) => {
      let alive = false;
      for (const a of ash) {
        if (t >= a.l) continue;
        alive = true;
        const k = t / a.l;
        g.circle(p.x + s.x * a.ox + a.vx * t, p.y + s.y * a.ox + a.g * t * t, a.r).fill({
          color: 0xd8d0c8,
          alpha: 0.75 * (1 - k),
        });
      }
      return alive;
    });
  }
}

function drawSmear(
  g: Graphics,
  path: (e: number) => Pose,
  head: number,
  geom: Geom,
  alpha: number,
  u: number,
): void {
  if (head <= 0.02) return;
  const N = 16;
  const pts: Pose[] = [];
  for (let i = 0; i < N; i++) pts.push(path((head * i) / (N - 1)));
  let len = 0;
  for (let i = 1; i < N; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (len < 14 * u) return;

  const hp = pts[N - 1];
  const td = norm(hp.x - pts[N - 2].x, hp.y - pts[N - 2].y);
  const n = perp(td);
  const c = Math.cos(hp.rot);
  const s = Math.sin(hp.rot);
  const W =
    Math.abs(n.x * c + n.y * s) * geom.hw * hp.sx + Math.abs(-n.x * s + n.y * c) * geom.hh * hp.sy;

  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N - 1, i + 1)];
    const nn = perp(norm(b.x - a.x, b.y - a.y));
    const w = W * 0.95 * Math.pow(i / (N - 1), 0.85);
    left.push(pts[i].x + nn.x * w, pts[i].y + nn.y * w);
    right.push(pts[i].x - nn.x * w, pts[i].y - nn.y * w);
  }
  const ribbon = [...left];
  for (let i = N - 1; i >= 0; i--) ribbon.push(right[i * 2], right[i * 2 + 1]);
  g.poly(ribbon).fill({ color: WHITE, alpha: 0.24 * alpha });

  const ghosts: [number, number][] = [
    [0.38, 0.22],
    [0.62, 0.38],
    [0.84, 0.6],
  ];
  for (const [f, a] of ghosts) {
    const gp = path(head * f);
    g.poly(flat(corners(gp, geom)))
      .fill({ color: WHITE, alpha: a * 0.22 * alpha })
      .stroke({ width: 2 * u, color: WHITE, alpha: a * alpha });
  }

  for (const off of [-0.72, 0.04, 0.68]) {
    const i0 = 1;
    const i1 = Math.floor(N * 0.72);
    for (let i = i0; i <= i1; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(N - 1, i + 1)];
      const nn = perp(norm(b.x - a.x, b.y - a.y));
      const x = pts[i].x + nn.x * W * off;
      const y = pts[i].y + nn.y * W * off;
      if (i === i0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke({ width: 2 * u, color: WHITE, alpha: 0.65 * alpha, cap: 'round' });
  }
}

// ——— Public entry points ———

export async function playHopAttack(hop: HopId, ctx: AttackContext): Promise<void> {
  const S = new Scene(ctx);
  try {
    await RECIPES[hop](S);
  } finally {
    S.finish();
  }
}

/** Break / Snap — shared interrupt for any illegal hop. The lunge never reaches the target. */
export async function playBreakSnap(ctx: AttackContext): Promise<void> {
  const S = new Scene(ctx);
  try {
    await breakSnap(S);
  } finally {
    S.finish();
  }
}

const RECIPES: Record<HopId, (S: Scene) => Promise<void>> = {
  GG: shoulderCheck,
  GK: uppercutLaunch,
  KA: skyHandoff,
  KS: meteorPin,
  AA: wingClip,
  AS: diveBomb,
  SG: aftershockPlant,
  SK: reboundSpring,
};

// ——— Recipes ———

/** G→G — lean back, flat ram face-to-face, target shoved along the floor. */
async function shoulderCheck(S: Scene): Promise<void> {
  const { a0, t0, u, tg } = S;
  await S.move(100, [{ card: S.A, to: at(a0, -14 * u, 5 * u, -0.08, 1.05, 0.93) }]);
  if (S.aborted) return;

  const m = vec(1, 0);
  const to = S.approach(vec(t0.x, t0.y + 4 * u), m, 0.05, 1.1, 0.93, 13 * u);
  const release = await S.strike(70, to, m, { bend: 0.1 });
  if (S.aborted) return;

  const hit = S.contact();
  const spin = S.spin(hit.p, m, 0.1);
  S.impact(hit, m, m, 0.4);
  setPose(S.T, at(t0, 4 * u, 0, spin, 0.86, 1.06));
  S.dust(hit.p.x, t0.y + tg.hh, 7, 0, 8 * u);
  await S.hold(60, { card: S.T, dir: m, amp: 3 * u });
  release();
  if (S.aborted) return;

  await S.move(80, [
    { card: S.T, to: at(t0, 26 * u, 0, spin * 1.5, 0.96, 1.02) },
    { card: S.A, to: at(to, 8 * u, 0, 0.02) },
  ]);
  if (S.aborted) return;
  await S.move(150, [
    { card: S.T, to: t0, ease: ease.outBack },
    { card: S.A, to: a0, ease: ease.inOutCubic },
  ]);
}

/** G→K — crouch, low dash, rising hit under the target's corner; target launched skyward. */
async function uppercutLaunch(S: Scene): Promise<void> {
  const { a0, t0, u, tg, ag } = S;
  S.dust(a0.x, a0.y + ag.hh, 6, 0, 18 * u);
  await S.move(120, [{ card: S.A, to: at(a0, -10 * u, 14 * u, 0.06, 1.1, 0.85) }]);
  if (S.aborted) return;

  const m = norm(1, -0.28);
  const to = S.approach(vec(t0.x - 0.25 * tg.hw, t0.y + 0.12 * tg.hh), m, -0.14, 0.92, 1.14, 15 * u);
  const release = await S.strike(85, to, m, { bend: 0.55 });
  if (S.aborted) return;

  const dir = norm(0.25, -1);
  const hit = S.contact();
  const spin = S.spin(hit.p, dir, 0.2);
  S.impact(hit, m, dir, 0.9, { invert: true });
  setPose(S.T, at(t0, 2 * u, -8 * u, spin, 0.9, 1.12));
  await S.hold(95, { card: S.T, dir, amp: 4 * u });
  release();
  if (S.aborted) return;

  const peak = at(t0, 16 * u, -0.6 * S.laneGap, spin * 2.2, 0.94, 1.1);
  await S.move(110, [
    { card: S.T, to: peak },
    { card: S.A, to: at(to, 4 * u, -26 * u, -0.06, 0.95, 1.1) },
  ]);
  if (S.aborted) return;
  await S.move(45, [{ card: S.T, to: at(peak, 2 * u, -6 * u, spin * 2.4), ease: ease.outQuad }]);
  if (S.aborted) return;
  await S.move(170, [
    { card: S.T, to: S.tLand(1.08, 0.9), ease: ease.inQuad },
    { card: S.A, to: a0, ease: ease.inOutCubic },
  ]);
  if (S.aborted) return;
  S.dust(t0.x, t0.y + tg.hh, 8, 0, tg.hw * 0.8);
  await S.move(90, [{ card: S.T, to: t0, ease: ease.outBack }]);
}

/** K→A — shoulder roll, diagonal glide into the low corner, twin wing slashes; target drifts on. */
async function skyHandoff(S: Scene): Promise<void> {
  const { a0, t0, u, tg } = S;
  await S.move(90, [{ card: S.A, to: at(a0, -6 * u, 8 * u, 0.1, 1.04, 0.94) }]);
  if (S.aborted) return;

  const aim = vec(t0.x - 0.3 * tg.hw, t0.y + 0.7 * tg.hh);
  const m = norm(aim.x - S.A.x, aim.y - S.A.y);
  const to = S.approach(aim, m, -0.14, 1.06, 0.97, 16 * u);
  const release = await S.strike(80, to, m, { bend: 0.3 });
  if (S.aborted) return;

  const dir = norm(0.8, -0.6);
  const hit = S.contact();
  const spin = S.spin(hit.p, dir, 0.14);
  S.impact(hit, m, dir, 0.55);
  const across = Math.atan2(dir.y, dir.x) + Math.PI / 2;
  S.slash(hit.p, across - 0.35, 1.5 * tg.hh, 7 * u, 200);
  S.slash(vec(hit.p.x + dir.x * 10 * u, hit.p.y + dir.y * 10 * u), across + 0.2, 1.2 * tg.hh, 5 * u, 190, 30);
  setPose(S.T, at(t0, 3 * u, -3 * u, spin, 0.95, 1.04));
  await S.hold(70, { card: S.T, dir, amp: 3 * u });
  release();
  if (S.aborted) return;

  await S.move(90, [
    { card: S.T, to: at(t0, 22 * u, -16 * u, spin * 1.6) },
    { card: S.A, to: at(to, 6 * u, -6 * u, -0.08) },
  ]);
  if (S.aborted) return;
  await S.move(165, [
    { card: S.T, to: t0, ease: ease.outBack },
    { card: S.A, to: a0, ease: ease.inOutCubic },
  ]);
}

/** K→S — self-launch (false continue), tuck, steep hammer onto the upper corner; target pinned down. */
async function meteorPin(S: Scene): Promise<void> {
  const { a0, t0, u, tg, ag } = S;
  const m = norm(1, 0.55);
  const to = S.approach(vec(t0.x - 0.4 * tg.hw, t0.y + 0.05 * tg.hh), m, 0.34, 0.92, 1.12, 16 * u);
  const risenY = Math.max(to.y - m.y * 100 * u, ag.hh * 1.14 + 12 * u);
  const risen = at(vec(to.x - m.x * 100 * u, risenY), 0, 0, -0.08, 0.9, 1.14);
  await S.move(130, [{ card: S.A, to: risen, ctrl: vec(a0.x - 6 * u, (a0.y + risen.y) / 2) }]);
  if (S.aborted) return;
  await S.move(55, [{ card: S.A, to: at(risen, -4 * u, -6 * u, 0.2, 1.06, 0.9), ease: ease.outQuad }]);
  if (S.aborted) return;

  const release = await S.strike(80, to, m, { ease: ease.inCubic, bend: 0.25 });
  if (S.aborted) return;

  const dir = norm(0.25, 1);
  const hit = S.contact();
  const spin = S.spin(hit.p, dir, 0.16);
  S.impact(hit, m, dir, 1, { invert: true });
  S.cracks(hit.p, dir, 3, 0.9 * tg.hh);
  setPose(S.T, at(t0, 2 * u, 8 * u, spin, 1.12, 0.84));
  await S.hold(100, { card: S.T, dir: vec(0, 1), amp: 4 * u });
  release();
  if (S.aborted) return;

  const pinned = at(t0, 10 * u, 0.5 * S.laneGap, spin * 1.4, 1.14, 0.84);
  await S.move(100, [
    { card: S.T, to: pinned },
    { card: S.A, to: at(to, 8 * u, 0.3 * S.laneGap, 0.3) },
  ]);
  if (S.aborted) return;
  const floor = vec(pinned.x, pinned.y + tg.hh * pinned.sy);
  S.ring(floor, 10 * u, 1.7 * tg.hw, 300, 3 * u, 0.22);
  S.dust(floor.x, floor.y, 10, 0, tg.hw * 0.7);
  S.shake(vec(0, 1), 3 * u);
  await S.move(200, [
    { card: S.T, to: t0, ease: ease.outBack },
    { card: S.A, to: a0, ease: ease.inOutCubic },
  ]);
}

/** A→A — minimal lean, fastest dart, one slash through the seam; snappy settle. */
async function wingClip(S: Scene): Promise<void> {
  const { a0, t0, u, tg } = S;
  await S.move(70, [{ card: S.A, to: at(a0, -10 * u, -3 * u, -0.1, 0.97, 1.03) }]);
  if (S.aborted) return;

  const m = norm(1, -0.08);
  const to = S.approach(vec(t0.x, t0.y - 0.1 * tg.hh), m, 0.1, 1.14, 0.92, 10 * u);
  const release = await S.strike(55, to, m, { bend: 0.1 });
  if (S.aborted) return;

  const dir = norm(1, -0.2);
  const hit = S.contact();
  const spin = S.spin(hit.p, dir, 0.14);
  S.impact(hit, m, dir, 0.25);
  S.slash(hit.p, Math.atan2(-1, 0.5), 1.9 * tg.hh, 7 * u, 180);
  setPose(S.T, at(t0, 3 * u, 0, spin, 0.94, 1.02));
  await S.hold(45, { card: S.T, dir, amp: 2 * u });
  release();
  if (S.aborted) return;

  await S.move(60, [
    { card: S.T, to: at(t0, 14 * u, -3 * u, spin * 1.6) },
    { card: S.A, to: at(to, 4 * u, -2 * u, 0.02) },
  ]);
  if (S.aborted) return;
  await S.move(130, [
    { card: S.T, to: t0, ease: ease.outBack },
    { card: S.A, to: a0 },
  ]);
}

/** A→S — climb back, pitch nose-down, straight spear dive; target slammed all the way to the floor. */
async function diveBomb(S: Scene): Promise<void> {
  const { a0, t0, u, tg, ag, ctx } = S;
  const climb = at(a0, -12 * u, -0.4 * ag.hh, -0.14, 0.95, 1.08);
  await S.move(100, [{ card: S.A, to: climb }]);
  if (S.aborted) return;
  await S.move(45, [{ card: S.A, to: at(climb, 4 * u, -4 * u, 0.42), ease: ease.outQuad }]);
  if (S.aborted) return;

  const m = norm(1, 0.5);
  const to = S.approach(vec(t0.x - 0.4 * tg.hw, t0.y - 0.05 * tg.hh), m, 0.46, 0.94, 1.1, 18 * u);
  const release = await S.strike(80, to, m, { ease: ease.inCubic, bend: 0.15 });
  if (S.aborted) return;

  const dir = norm(0.3, 1);
  const hit = S.contact();
  const spin = S.spin(hit.p, dir, 0.16);
  S.impact(hit, m, dir, 0.95, { invert: true });
  setPose(S.T, at(t0, 3 * u, 6 * u, spin, 1.1, 0.86));
  await S.hold(90, { card: S.T, dir: vec(0, 1), amp: 4 * u });
  release();
  if (S.aborted) return;

  const floorY = Math.max(ctx.groundY, t0.y + 0.6 * S.laneGap) + tg.hh;
  const slamSy = 0.8;
  const slammed = at(vec(t0.x + 12 * u, floorY - tg.hh * slamSy), 0, 0, spin * 0.6, 1.18, slamSy);
  await S.move(110, [
    { card: S.T, to: slammed, ease: ease.inQuad },
    { card: S.A, to: at(to, 12 * u, 0.4 * (slammed.y - t0.y), 0.6) },
  ]);
  if (S.aborted) return;
  S.ring(vec(slammed.x, floorY), 12 * u, 2.4 * tg.hw, 360, 4 * u, 0.2);
  S.ring(vec(slammed.x, floorY), 8 * u, 1.4 * tg.hw, 260, 3 * u, 0.2);
  S.dust(slammed.x, floorY, 14, 0, tg.hw);
  S.shake(vec(0, 1), 5 * u);
  await S.hold(40);
  if (S.aborted) return;
  await S.move(220, [
    { card: S.T, to: t0, ease: ease.outBack },
    { card: S.A, to: a0, ease: ease.inOutCubic },
  ]);
}

/** S→G — hop, drop down beside the target, planted shove; double aftershock ring along the floor. */
async function aftershockPlant(S: Scene): Promise<void> {
  const { a0, t0, u, tg } = S;
  await S.move(100, [{ card: S.A, to: at(a0, -6 * u, -14 * u, -0.06, 0.94, 1.08) }]);
  if (S.aborted) return;

  const m = norm(1, 0.3);
  const to = S.approach(vec(t0.x - 0.3 * tg.hw, t0.y + 0.1 * tg.hh), m, 0.08, 1.06, 0.95, 14 * u);
  const release = await S.strike(90, to, m, { bend: 0.4 });
  if (S.aborted) return;

  const dir = norm(1, 0.25);
  const hit = S.contact();
  const spin = S.spin(hit.p, dir, 0.12);
  S.impact(hit, m, dir, 0.6);
  setPose(S.T, at(t0, 3 * u, 2 * u, spin, 0.9, 1.04));
  const footY = t0.y + tg.hh;
  S.ring(vec(hit.p.x, footY), 8 * u, 2.2 * tg.hw, 320, 3.5 * u, 0.2);
  S.dust(hit.p.x, footY, 10, 0, 16 * u);
  await S.hold(75, { card: S.T, dir, amp: 3 * u });
  release();
  if (S.aborted) return;

  S.ring(vec(t0.x, footY), 8 * u, 2.9 * tg.hw, 420, 2.5 * u, 0.2);
  await S.move(80, [
    { card: S.T, to: at(t0, 20 * u, 0, spin * 1.2, 0.95, 1.02) },
    { card: S.A, to: at(to, 4 * u, 0, 0, 1.04, 0.96) },
  ]);
  if (S.aborted) return;
  await S.move(200, [
    { card: S.T, to: t0, ease: ease.outBack },
    { card: S.A, to: a0, ease: ease.inOutCubic, ctrl: vec((to.x + a0.x) / 2, a0.y - 20 * u) },
  ]);
}

/** S→K — hop over, land on the target's top, coil both cards, then spring the target up. */
async function reboundSpring(S: Scene): Promise<void> {
  const { a0, t0, u, tg, ag } = S;
  await S.move(90, [{ card: S.A, to: at(a0, 4 * u, -18 * u, -0.04, 0.92, 1.1) }]);
  if (S.aborted) return;

  const m = norm(0.12, 1);
  const to = S.approach(vec(t0.x - 0.15 * tg.hw, t0.y - 0.3 * tg.hh), m, 0, 1.06, 0.94, 14 * u);
  const release = await S.strike(90, to, m, { bend: 0.7 });
  if (S.aborted) return;

  const down = vec(0, 1);
  const hit = S.contact();
  S.impact(hit, m, down, 0.7);
  const squash1 = 0.8;
  setPose(S.T, S.tLand(1.12, squash1));
  setPose(S.A, at(to, 0, (1 - squash1) * 2 * tg.hh + ag.hh * 0.1, 0, 1.08, 0.9));
  await S.hold(60, { card: S.T, dir: down, amp: 3 * u });
  release();
  if (S.aborted) return;

  const squash2 = 0.66;
  const bottom = t0.y + tg.hh;
  S.coils([t0.x - tg.hw - 10 * u, t0.x + tg.hw + 10 * u], bottom, () => 2 * tg.hh * S.T.scale.y, 200);
  await S.move(70, [
    { card: S.T, to: S.tLand(1.18, squash2), ease: ease.outQuad },
    { card: S.A, to: at(to, 0, (1 - squash2) * 2 * tg.hh + ag.hh * 0.14, 0, 1.1, 0.86), ease: ease.outQuad },
  ]);
  if (S.aborted) return;

  S.ring(vec(t0.x, bottom), 10 * u, 1.9 * tg.hw, 300, 3.5 * u, 0.22);
  S.chevrons(t0.x, bottom - 10 * u, 3, 280);
  S.sparks(vec(t0.x, bottom), vec(0, -1), 8, 0.7 * u, 0.5, 220);
  S.dust(t0.x, bottom, 8, 0, tg.hw * 0.6);
  S.shake(vec(0, -1), 4 * u);
  const peak = at(t0, 4 * u, -0.55 * S.laneGap, 0.06, 0.88, 1.16);
  await S.move(100, [
    { card: S.T, to: peak },
    { card: S.A, to: at(a0, 14 * u, -26 * u, -0.12, 0.94, 1.08), ctrl: vec(to.x, to.y - 50 * u) },
  ]);
  if (S.aborted) return;
  await S.move(40, [{ card: S.T, to: at(peak, 0, -6 * u, 0.08), ease: ease.outQuad }]);
  if (S.aborted) return;
  await S.move(170, [
    { card: S.T, to: S.tLand(1.06, 0.9), ease: ease.inQuad },
    { card: S.A, to: a0, ease: ease.inOutCubic },
  ]);
  if (S.aborted) return;
  S.dust(t0.x, bottom, 8, 0, tg.hw * 0.8);
  await S.move(90, [{ card: S.T, to: t0, ease: ease.outBack }]);
}

/** Illegal hop — lunge decelerates and stops short; the empty gap cracks; nothing lands. */
async function breakSnap(S: Scene): Promise<void> {
  const { a0, t0, u, ag, tg } = S;
  const m = norm(t0.x - a0.x, t0.y - a0.y);
  const lean = Math.sign(m.x || 1);
  const would = S.approach(vec(t0.x, t0.y), m, 0, 1, 1, 0);

  await S.move(60, [{ card: S.A, to: at(a0, -m.x * 6 * u, -m.y * 6 * u, -0.05 * lean, 1.03, 0.97) }]);
  if (S.aborted) return;
  const stop = at(vec(lerp(a0.x, would.x, 0.55), lerp(a0.y, would.y, 0.55)), 0, 0, 0.05 * lean, 1.05, 0.96);
  await S.move(90, [{ card: S.A, to: stop, ease: ease.outQuad }]);
  if (S.aborted) return;

  const lead = support(stop, ag, m);
  const near = support(t0, tg, vec(-m.x, -m.y));
  const gap = vec((lead.x + near.x) / 2, (lead.y + near.y) / 2);
  S.markContact();
  S.snap(gap, m, 0.75 * Math.min(ag.hh, tg.hh));
  await S.hold(50, { card: S.A, dir: m, amp: 3 * u });
  if (S.aborted) return;

  await S.move(140, [
    { card: S.A, to: at(a0, -m.x * 8 * u, -m.y * 8 * u, 0, 0.97, 0.97) },
    { card: S.T, to: at(t0, m.x * 6 * u, m.y * 6 * u, 0.03 * lean) },
  ]);
  if (S.aborted) return;
  await S.move(90, [
    { card: S.A, to: a0 },
    { card: S.T, to: t0 },
  ]);
  S.T.alpha = Math.min(S.T.alpha, 0.45);
}
