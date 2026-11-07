import { Application, Container, Graphics, Rectangle, Text, TextStyle, Ticker } from 'pixi.js';
import { AttackContext, hopIdFor, playBreakSnap, playHopAttack } from './attacks';
import {
  CardDef,
  Lane,
  LinkInfo,
  TYPE_COLORS,
  TYPE_NAMES,
  chainLength,
  computeLanes,
  evaluateLinks,
  firstBreakIndex,
  isLaneChanger,
  laneAfter,
  resolveChainDamage,
} from './rules';
import { hopDamageFromLinks } from './hopDamage';

const W = 960;
const H = 640;
const CARD_W = 108;
const CARD_H = 142;
const LANE_Y = [330, 180] as const; // bottom, top play lanes (headroom above air for overhead strikes)
const SLOT_X = [110, 280, 450, 620, 790];
const HAND_Y = 545;
const MAX_SLOTS = 5;

// Hop contact geometry (attacks.ts) is measured from card bounds; keep this equal to the stroked card outline.
const CARD_BOUNDS = new Rectangle(-CARD_W / 2 - 1.5, -CARD_H / 2 - 1.5, CARD_W + 3, CARD_H + 3);
const DECK_AT = { x: W + 70, y: HAND_Y - 46 };
const DISCARD_AT = { x: -90, y: HAND_Y - 30 };
const COMBO_AT = { x: W - 74, y: 46 };
/** Hand tray is empty or sunk during resolve, so the total never covers the line or GM notes. */
const STAMP_AT = { x: W / 2, y: HAND_Y - 10 };

const MARKER = '"Permanent Marker", "Bebas Neue", Impact, sans-serif';
const INK_OK = 0x63c98f;
const INK_BREAK = 0xf05a45;
const INK_NOTE = 0xf3c7b8;
const INK_SHADOW = 0x0b0705;
const GOLD = 0xf0c36a;
const DIM_TINT = 0x958a7f;

export type BoardPhase = 'empty' | 'building' | 'resolving' | 'resolved';

export type ResolveDamageMode = 'cards' | 'hops';

export interface ResolveOptions {
  damageMode?: ResolveDamageMode;
  onRecoil?: () => void | Promise<void>;
}

export interface BoardHudSnapshot {
  linksLabel: string;
  damageLabel: string;
  phase: BoardPhase;
  playCount: number;
  handCount: number;
}

type ChangeListener = () => void;

// ——— Small math kit ———

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const ease = {
  outQuad: (t: number) => 1 - (1 - t) ** 2,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

function poseOf(c: Container): Pose {
  return { x: c.x, y: c.y, rot: c.rotation, sx: c.scale.x, sy: c.scale.y };
}

function setPose(c: Container, p: Pose): void {
  c.position.set(p.x, p.y);
  c.rotation = p.rot;
  c.scale.set(p.sx, p.sy);
}

function rest(x: number, y: number, rot = 0): Pose {
  return { x, y, rot, sx: 1, sy: 1 };
}

function samePose(a: Pose, b: Pose): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.rot - b.rot) < 0.002;
}

function quad(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function quadTangent(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const x = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  const y = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ——— Card views (persistent nodes that travel deck → hand → line → discard) ———

type Zone = 'hand' | 'play';
type MotionKind = 'deal' | 'place' | 'peel' | 'shift' | 'flip' | 'discard';

interface MotionProfile {
  /** Pick-up beat in place before travelling (peel). */
  pre: number;
  dur: number;
  /** Squash-and-settle after arrival. */
  land: number;
  landAmp: number;
  /** 0..1 how high the card rises mid-flight (scale bump + shadow spread). */
  lift: number;
  lean: number;
  arc: number;
  ease: (t: number) => number;
}

const PROFILE: Record<MotionKind, MotionProfile> = {
  deal: { pre: 0, dur: 430, land: 180, landAmp: 0.05, lift: 0.7, lean: 0.12, arc: 46, ease: ease.outCubic },
  place: { pre: 0, dur: 300, land: 220, landAmp: 0.09, lift: 1, lean: 0.1, arc: 64, ease: ease.inOutCubic },
  peel: { pre: 90, dur: 290, land: 160, landAmp: 0.05, lift: 0.8, lean: -0.1, arc: 30, ease: ease.inOutCubic },
  shift: { pre: 0, dur: 230, land: 0, landAmp: 0, lift: 0, lean: 0, arc: 0, ease: ease.outCubic },
  flip: { pre: 0, dur: 280, land: 0, landAmp: 0, lift: 0.4, lean: 0, arc: 0, ease: ease.inOutQuad },
  discard: { pre: 0, dur: 400, land: 0, landAmp: 0, lift: 0.5, lean: -0.2, arc: 36, ease: ease.inCubic },
};

interface Motion {
  kind: MotionKind;
  prof: MotionProfile;
  from: Pose;
  to: Pose;
  ctrl: Vec | null;
  t: number;
  delay: number;
  flip: boolean;
  flipped: boolean;
  alphaFrom: number;
  alphaTo: number | null;
  layer: Container;
  landed: boolean;
  done: () => void;
  promise: Promise<void>;
}

interface CardView {
  card: CardDef;
  node: Container;
  inner: Container;
  face: Container;
  back: Container;
  badge: Text;
  shadow: Graphics;
  faceUp: boolean;
  zone: Zone | null;
  target: Pose | null;
  motion: Motion | null;
  flipX: number;
  hover: number;
  lift: number;
}

type ChromeFx = (t: number, g: Graphics) => boolean;

/** Ink path between two play cards: quadratic bezier plus a stable hand wobble. */
interface InkPath {
  p0: Vec;
  c: Vec;
  p1: Vec;
  seed: number;
}

function inkAt(ep: InkPath, s: number): Vec {
  const b = quad(ep.p0, ep.c, ep.p1, s);
  const d = quadTangent(ep.p0, ep.c, ep.p1, s);
  const wob =
    (Math.sin(s * 8.5 + ep.seed) * 1.1 + Math.sin(s * 21 + ep.seed * 1.7) * 0.5) * Math.sin(Math.PI * s);
  return { x: b.x - d.y * wob, y: b.y + d.x * wob };
}

function inkPressure(s: number, seed: number, taper: boolean): number {
  const attack = 0.4 + 0.6 * smooth(0, 0.12, s);
  const release = taper ? 1 - 0.55 * smooth(0.8, 1, s) : 1;
  return attack * release * (1 + 0.1 * Math.sin(s * 15 + seed));
}

/**
 * Pixi board: hand strip + empty play line.
 * Click hand → append to play line. Click play card → return it (and later cards) to hand.
 * Resolve allowed with ≥1 card on the play line (partial lines OK for this rough loop).
 */
export class GameBoard {
  readonly app: Application;
  private root = new Container();
  private laneLayer = new Container();
  private slotLayer = new Container();
  private shadowLayer = new Container();
  private chromeG = new Graphics();
  private playLayer = new Container();
  private handLayer = new Container();
  private flyLayer = new Container();
  private inkLayer = new Container();
  private fxLayer = new Container();
  private hudLayer = new Container();
  private titleText: Text;
  private hintText: Text;

  private hand: CardDef[] = [];
  private play: CardDef[] = [];
  private lanes: Lane[] = [];
  private links: LinkInfo[] = [];
  private phase: BoardPhase = 'empty';
  private playNodes: Container[] = [];
  private animToken = 0;
  private onChange: ChangeListener | null = null;
  private handFaceDown = false;
  private allowInteraction = true;

  private views = new Map<string, CardView>();
  private leaving = new Set<CardView>();
  private placeQueueUntil = 0;
  private slotFrames: Graphics[] = [];
  private slotNums: Text[] = [];
  private chromeFx: { t: number; fn: ChromeFx }[] = [];
  private clock = 0;
  private titlePop = 1;
  private nudgeTimer = 0;
  /** Last pointer position in board space (null when outside the canvas). */
  private pointer: Vec | null = null;

  private combo!: {
    node: Container;
    body: Container;
    num: Text;
    flash: Text;
    label: Text;
    count: number;
    punch: number;
    shake: number;
  };

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.root);
    this.shadowLayer.addChild(this.chromeG);
    this.root.addChild(
      this.laneLayer,
      this.slotLayer,
      this.shadowLayer,
      this.playLayer,
      this.handLayer,
      this.flyLayer,
      this.inkLayer,
      this.fxLayer,
      this.hudLayer,
    );
    this.drawBackdrop();
    this.titleText = new Text({
      text: 'Deal a hand to begin',
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 22,
        fill: 0xc9b896,
        fontWeight: '600',
      }),
    });
    this.titleText.anchor.set(0.5, 0.5);
    this.titleText.position.set(W / 2, 36);

    this.hintText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 14,
        fill: 0x8a7a68,
        fontWeight: '600',
      }),
    });
    this.hintText.anchor.set(0.5, 0.5);
    this.hintText.position.set(W / 2, 62);

    // Behind the cards: overhead strikes (climbs, launches) pass over the title instead of under it.
    this.root.addChildAt(this.titleText, 1);
    this.root.addChildAt(this.hintText, 2);
    this.drawLaneGuides();
    this.drawEmptySlots();
    this.drawHandRail();
    this.buildCombo();
    // Hover is hit-tested per frame: Pixi's over/out tracking drops a node once it is reparented mid-flight.
    const canvas = app.canvas;
    const track = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.pointer = { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    };
    canvas.addEventListener('pointermove', track);
    canvas.addEventListener('pointerdown', track);
    canvas.addEventListener('pointerleave', () => (this.pointer = null));
    app.ticker.add(this.tick);
  }

  static async create(host: HTMLElement): Promise<GameBoard> {
    const app = new Application();
    await app.init({
      width: W,
      height: H,
      background: 0x2b2118,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    // Pixi bakes text with whatever font is ready at creation; wait briefly so the GM ink gets its marker.
    await Promise.race([
      Promise.all([
        document.fonts.load('24px "Permanent Marker"'),
        document.fonts.load('40px "Bebas Neue"'),
        document.fonts.load('700 12px "Source Sans 3"'),
      ]).catch(() => undefined),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    host.replaceChildren(app.canvas);
    return new GameBoard(app);
  }

  setChangeListener(fn: ChangeListener | null): void {
    this.onChange = fn;
  }

  get snapshot(): BoardHudSnapshot {
    if (this.phase === 'empty') {
      return {
        linksLabel: 'deal to begin',
        damageLabel: '—',
        phase: this.phase,
        playCount: 0,
        handCount: 0,
      };
    }
    if (this.play.length === 0) {
      return {
        linksLabel: 'click hand cards to build the chain',
        damageLabel: '—',
        phase: this.phase,
        playCount: 0,
        handCount: this.hand.length,
      };
    }
    // While building: never leak validity / expected damage (hidden until resolve).
    if (this.phase === 'building') {
      return {
        linksLabel:
          this.play.length === 1
            ? '1 card on the line · resolve when ready'
            : `${this.play.length} cards on the line · resolve when ready`,
        damageLabel: '?',
        phase: this.phase,
        playCount: this.play.length,
        handCount: this.hand.length,
      };
    }
    const valid = this.links.filter((l) => l.valid).length;
    const breakAt = firstBreakIndex(this.links);
    const prefix = chainLength(this.links);
    const dmg = resolveChainDamage(this.play, this.links);
    const linksLabel =
      this.links.length === 0
        ? 'single card'
        : `${valid}/${this.links.length} valid · chain ${prefix}/${this.links.length}` +
          (breakAt >= 0 ? ` · breaks at ${breakAt + 1}→${breakAt + 2}` : '');
    return {
      linksLabel,
      damageLabel: String(dmg),
      phase: this.phase,
      playCount: this.play.length,
      handCount: this.hand.length,
    };
  }

  /** Full hand currently held (not yet on play line). */
  getHandCards(): CardDef[] {
    return [...this.hand];
  }

  /** Cards ordered on the play line. */
  getPlayCards(): CardDef[] {
    return [...this.play];
  }

  setHandFaceDown(faceDown: boolean): void {
    this.handFaceDown = faceDown;
    if (this.phase === 'building') this.sync();
  }

  setInteractionAllowed(allowed: boolean): void {
    this.allowInteraction = allowed;
  }

  /** Programmatic build step (PvC AI). */
  playCardById(cardId: string): boolean {
    if (this.phase !== 'building') return false;
    const idx = this.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return false;
    this.forcePlayFromHand(idx);
    return true;
  }

  /** Instantly empties the board (no sweep). */
  clear(): void {
    this.animToken += 1;
    for (const v of [...this.views.values(), ...this.leaving]) this.destroyView(v);
    this.views.clear();
    this.leaving.clear();
    this.resetState();
    this.inkLayer.removeChildren();
    this.fxLayer.removeChildren();
    this.setTitle('Deal a hand to begin');
    this.hintText.text = '';
    this.emit();
  }

  /** Sweep every card (line + hand) off to the discard side, then leave the board empty. */
  async discardAll(): Promise<void> {
    const outgoing = this.sweepAway();
    this.resetState();
    this.setTitle('');
    this.hintText.text = '';
    this.emit();
    await outgoing;
    this.fxLayer.removeChildren();
    if (this.phase === 'empty') this.setTitle('Deal a hand to begin');
  }

  /** Deal into hand only — play line stays empty for the player to build. */
  dealToHand(cards: CardDef[], opts: { instant?: boolean } = {}): BoardHudSnapshot {
    if (opts.instant) this.clear();
    else void this.sweepAway();
    this.resetState();
    this.hand = [...cards];
    this.phase = 'building';
    this.setTitle('Build your chain');
    this.hintText.text = 'Click a hand card to play · click a played card to take it back';
    this.sync(opts.instant);
    this.emit();
    return this.snapshot;
  }

  /**
   * Demo helper: deal into hand, then auto-play the given order onto the line.
   * Remaining hand cards (if any) stay in hand. Snaps into place so capture timings stay stable.
   */
  dealAndPlay(handCards: CardDef[], playOrder: CardDef[]): BoardHudSnapshot {
    this.dealToHand(handCards, { instant: true });
    for (const card of playOrder) {
      const idx = this.hand.findIndex((c) => c.id === card.id);
      if (idx >= 0 && this.play.length < MAX_SLOTS) this.play.push(...this.hand.splice(idx, 1));
    }
    this.refreshAll(true);
    return this.snapshot;
  }

  clearPlayLine(): void {
    if (this.phase !== 'building') return;
    this.hand = [...this.hand, ...this.play];
    this.play = [];
    this.refreshAll();
  }

  async resolve(opts?: ResolveOptions): Promise<BoardHudSnapshot> {
    if (this.phase !== 'building' || this.play.length === 0) return this.snapshot;
    this.phase = 'resolving';
    this.emit();
    const token = ++this.animToken;
    const damageMode = opts?.damageMode ?? 'cards';
    const dmg =
      damageMode === 'hops'
        ? hopDamageFromLinks(this.links)
        : resolveChainDamage(this.play, this.links);
    const unbroken = chainLength(this.links);
    const breakAt = firstBreakIndex(this.links);

    await this.settle();
    if (token !== this.animToken) return this.snapshot;
    this.restPlayCards();
    // No pre-resolve validity glyphs — the ink layer stays empty until the verdict draw.
    this.inkLayer.removeChildren();
    this.hintText.text = '';

    // 1) lock beat → 2) hop attacks (chain lights up per contact) → 3) GM ink → 4) score stamp
    await this.lockIn(token);
    if (token !== this.animToken) return this.snapshot;

    await this.animateChainTravel(unbroken, breakAt, token, opts);
    if (token !== this.animToken) return this.snapshot;

    await this.wait(150);
    await this.drawVerdictLinks(breakAt, token);
    if (token !== this.animToken) return this.snapshot;

    await this.scoreStamp(dmg, damageMode, token);
    if (token !== this.animToken) return this.snapshot;

    this.phase = 'resolved';
    const breakNote = breakAt >= 0 ? ` · broke at ${this.play[breakAt].type}→${this.play[breakAt + 1].type}` : '';
    this.setTitle(
      damageMode === 'hops'
        ? `Resolved · ${dmg} ${dmg === 1 ? 'hop' : 'hops'}${breakNote}`
        : `Resolved · ${dmg} damage${breakNote}`,
    );
    this.hintText.text = breakAt >= 0 ? 'Chain stopped at the broken link' : 'Full chain connected';
    this.emit();
    return this.snapshot;
  }

  private emit(): void {
    this.onChange?.();
  }

  private resetState(): void {
    this.hand = [];
    this.play = [];
    this.lanes = [];
    this.links = [];
    this.playNodes = [];
    this.phase = 'empty';
    this.hideCombo();
  }

  private playFromHand(handIndex: number): void {
    if (this.phase !== 'building' || !this.allowInteraction) return;
    this.forcePlayFromHand(handIndex);
  }

  /** AI / PvC: play from hidden hand without requiring allowInteraction. */
  forcePlayFromHand(handIndex: number): void {
    if (this.phase !== 'building') return;
    if (handIndex < 0 || handIndex >= this.hand.length) return;
    if (this.play.length >= MAX_SLOTS) return;
    const [card] = this.hand.splice(handIndex, 1);
    this.play.push(card);
    this.refreshAll();
  }

  /** Return this play-line card and everything after it to hand (keeps earlier order intact). */
  private returnFromPlay(playIndex: number): void {
    if (this.phase !== 'building' || !this.allowInteraction) return;
    if (playIndex < 0 || playIndex >= this.play.length) return;
    const removed = this.play.splice(playIndex);
    this.hand.push(...removed);
    this.refreshAll();
  }

  private refreshAll(instant = false): void {
    this.lanes = computeLanes(this.play);
    this.links = evaluateLinks(this.play);
    this.sync(instant);
    if (this.play.length === 0) {
      this.setTitle('Build your chain');
    } else if (!this.handFaceDown) {
      this.setTitle(this.play.map((c) => c.type).join(' → '));
    } else {
      this.setTitle(`${this.play.length} card${this.play.length === 1 ? '' : 's'} on the line`);
    }
    this.emit();
  }

  // ——— Layout + motion ———

  private handPose(i: number, n: number): Pose {
    const o = i - (n - 1) / 2;
    return rest(this.handX(i, n), HAND_Y + o * o * 2.4, o * 0.035);
  }

  private playPose(i: number): Pose {
    return rest(SLOT_X[i], LANE_Y[this.lanes[i] ?? 0]);
  }

  private handX(index: number, count: number): number {
    const spread = Math.min(170, 700 / Math.max(count, 1));
    const total = spread * (count - 1);
    const start = W / 2 - total / 2;
    return start + index * spread;
  }

  /** Diff hand/line against the card views and launch whatever motion each card needs. */
  private sync(instant = false): void {
    const now = performance.now();
    let dealN = 0;
    let peelN = 0;
    const apply = (card: CardDef, zone: Zone, index: number, to: Pose) => {
      const wantUp = zone === 'play' || !this.handFaceDown;
      let v = this.views.get(card.id);
      if (!v) {
        const deck: Pose = { x: DECK_AT.x, y: DECK_AT.y, rot: 0.5, sx: 0.92, sy: 0.92 };
        v = this.createView(card, instant ? wantUp : false, instant ? to : deck);
        this.views.set(card.id, v);
      }
      v.badge.text = String(index + 1);
      v.badge.visible = zone === 'play';
      const prevZone = v.zone;
      const moved = !v.target || prevZone !== zone || !samePose(v.target, to);
      const flip = v.faceUp !== wantUp;
      v.zone = zone;
      v.target = to;
      const layer = zone === 'hand' ? this.handLayer : this.playLayer;
      if (instant) {
        v.motion?.done();
        v.motion = null;
        v.flipX = 1;
        setPose(v.node, to);
        this.showFace(v, wantUp);
        layer.addChild(v.node);
        return;
      }
      if (!moved && !flip) return;
      let kind: MotionKind;
      let delay = 0;
      if (prevZone === null) {
        kind = 'deal';
        delay = dealN++ * 80;
      } else if (prevZone === 'hand' && zone === 'play') {
        kind = 'place';
        delay = Math.max(0, this.placeQueueUntil - now);
        this.placeQueueUntil = now + delay + 70;
      } else if (prevZone === 'play' && zone === 'hand') {
        kind = 'peel';
        delay = peelN++ * 55;
      } else if (!moved) {
        kind = 'flip';
      } else {
        kind = 'shift';
        delay = 30;
      }
      void this.startMotion(v, kind, to, { delay, flip, layer });
    };
    this.play.forEach((card, i) => apply(card, 'play', i, this.playPose(i)));
    this.hand.forEach((card, i) => apply(card, 'hand', i, this.handPose(i, this.hand.length)));
  }

  private startMotion(
    v: CardView,
    kind: MotionKind,
    to: Pose,
    opts: { delay?: number; flip?: boolean; layer: Container; alpha?: number },
  ): Promise<void> {
    v.motion?.done();
    const prof = PROFILE[kind];
    const from = poseOf(v.node);
    let done!: () => void;
    const promise = new Promise<void>((r) => (done = r));
    let ctrl: Vec | null = null;
    if (prof.arc > 0) {
      const lead = kind === 'peel' ? { ...from, y: from.y - 12 } : from;
      ctrl = { x: (lead.x + to.x) / 2, y: Math.min(lead.y, to.y) - prof.arc };
    }
    v.motion = {
      kind,
      prof,
      from,
      to,
      ctrl,
      t: 0,
      delay: opts.delay ?? 0,
      flip: !!opts.flip,
      flipped: false,
      alphaFrom: v.node.alpha,
      alphaTo: opts.alpha ?? null,
      layer: opts.layer,
      landed: false,
      done,
      promise,
    };
    if (kind !== 'shift' && kind !== 'flip') this.flyLayer.addChild(v.node);
    return promise;
  }

  private stepMotion(v: CardView, dt: number): void {
    const m = v.motion;
    if (!m) return;
    m.t += dt;
    let t = m.t - m.delay;
    if (t < 0) return;
    const { prof } = m;
    const node = v.node;
    const pickup: Pose = { ...m.from, y: m.from.y - 12, rot: m.from.rot - 0.06, sx: 1.07, sy: 1.07 };

    if (t < prof.pre) {
      const k = ease.outCubic(t / prof.pre);
      setPose(node, {
        x: m.from.x,
        y: lerp(m.from.y, pickup.y, k),
        rot: lerp(m.from.rot, pickup.rot, k),
        sx: lerp(m.from.sx, pickup.sx, k),
        sy: lerp(m.from.sy, pickup.sy, k),
      });
      v.lift = 0.45 * k;
      return;
    }
    t -= prof.pre;
    const start = prof.pre > 0 ? pickup : m.from;

    if (t < prof.dur) {
      const p = t / prof.dur;
      const e = prof.ease(p);
      const pos = m.ctrl ? quad(start, m.ctrl, m.to, e) : { x: lerp(start.x, m.to.x, e), y: lerp(start.y, m.to.y, e) };
      const bump = Math.sin(Math.PI * e);
      const grow = 1 + 0.08 * bump * prof.lift;
      const dir = Math.sign(m.to.x - start.x) || 1;
      setPose(node, {
        x: pos.x,
        y: pos.y,
        rot: lerp(start.rot, m.to.rot, e) + prof.lean * dir * bump,
        sx: lerp(start.sx, m.to.sx, e) * grow,
        sy: lerp(start.sy, m.to.sy, e) * grow,
      });
      v.lift = Math.max(bump * prof.lift, prof.pre > 0 ? 0.45 * (1 - e) : 0);
      if (m.flip) {
        const fq = clamp((p - 0.3) / 0.4, 0, 1);
        v.flipX = Math.max(0.02, Math.abs(Math.cos(fq * Math.PI)));
        if (fq >= 0.5 && !m.flipped) {
          m.flipped = true;
          this.showFace(v, !v.faceUp);
        }
      }
      if (m.alphaTo !== null) node.alpha = lerp(m.alphaFrom, m.alphaTo, smooth(0.35, 1, p));
      return;
    }
    t -= prof.dur;
    if (m.flip && !m.flipped) {
      m.flipped = true;
      this.showFace(v, !v.faceUp);
    }
    v.flipX = 1;
    v.lift = 0;
    if (m.alphaTo !== null) node.alpha = m.alphaTo;

    if (t < prof.land) {
      if (!m.landed) {
        m.landed = true;
        m.layer.addChild(node);
        if (m.kind === 'place') this.landingRing(m.to);
      }
      const k = t / prof.land;
      const s = prof.landAmp * Math.exp(-4.5 * k) * Math.cos(k * Math.PI * 2.5);
      setPose(node, { ...m.to, sx: m.to.sx * (1 + s * 0.6), sy: m.to.sy * (1 - s) });
      return;
    }

    setPose(node, m.to);
    if (!m.landed) {
      m.landed = true;
      m.layer.addChild(node);
    }
    v.motion = null;
    m.done();
  }

  /** Resolves once every card has finished travelling. */
  private async settle(): Promise<void> {
    for (let guard = 0; guard < 8; guard++) {
      const pending = [...this.views.values()].flatMap((v) => (v.motion ? [v.motion.promise] : []));
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  /** Attack recipes read their rest pose from the node, so the line must be exactly at rest. */
  private restPlayCards(): void {
    this.playNodes = [];
    this.play.forEach((card, i) => {
      const v = this.views.get(card.id);
      if (!v) return;
      v.hover = 0;
      v.flipX = 1;
      v.inner.position.set(0, 0);
      v.inner.rotation = 0;
      v.inner.scale.set(1);
      setPose(v.node, this.playPose(i));
      this.playLayer.addChild(v.node);
      this.playNodes.push(v.node);
    });
  }

  /** Move every current card into the leaving set and sweep it off-board. */
  private sweepAway(): Promise<void> {
    const outgoing = [...this.views.values()];
    this.views.clear();
    this.fadeOutLayer(this.inkLayer, 220);
    outgoing.sort((a, b) => a.node.x - b.node.x);
    const done = outgoing.map((v, i) => {
      this.leaving.add(v);
      v.zone = null;
      v.hover = 0;
      v.node.eventMode = 'none';
      const to: Pose = {
        x: DISCARD_AT.x,
        y: DISCARD_AT.y + rand(-16, 16),
        rot: -0.55 + rand(-0.15, 0.15),
        sx: 0.86,
        sy: 0.86,
      };
      return this.startMotion(v, 'discard', to, { delay: i * 28, layer: this.flyLayer, alpha: 0 }).then(() =>
        this.destroyView(v),
      );
    });
    return Promise.all(done).then(() => undefined);
  }

  private destroyView(v: CardView): void {
    v.motion?.done();
    v.motion = null;
    this.leaving.delete(v);
    if (!v.node.destroyed) v.node.destroy({ children: true });
    if (!v.shadow.destroyed) v.shadow.destroy();
  }

  private isTappable(v: CardView): boolean {
    if (this.phase !== 'building' || !this.allowInteraction || !v.zone) return false;
    return !(v.zone === 'hand' && this.handFaceDown);
  }

  /** Topmost settled, tappable card under the pointer. */
  private pickHover(): CardView | null {
    if (!this.pointer || this.phase !== 'building') return null;
    let pick: CardView | null = null;
    for (const v of this.views.values()) {
      if (v.motion || v.node.destroyed || !this.isTappable(v)) continue;
      const p = v.node.toLocal(this.pointer);
      if (Math.abs(p.x) <= CARD_W / 2 && Math.abs(p.y) <= CARD_H / 2) pick = v;
    }
    return pick;
  }

  private onTap(v: CardView): void {
    if (!this.isTappable(v)) return;
    const hi = this.hand.findIndex((c) => c.id === v.card.id);
    if (hi >= 0) {
      this.playFromHand(hi);
      return;
    }
    const pi = this.play.findIndex((c) => c.id === v.card.id);
    if (pi >= 0) this.returnFromPlay(pi);
  }

  private showFace(v: CardView, up: boolean): void {
    v.faceUp = up;
    v.face.visible = up;
    v.back.visible = !up;
  }

  // ——— Per-frame chrome ———

  private tick = (ticker: Ticker): void => {
    const dt = Math.min(ticker.deltaMS, 50);
    this.clock += dt;
    const hovered = this.pickHover();
    this.app.canvas.style.cursor = hovered ? 'pointer' : 'default';
    for (const v of this.views.values()) this.stepView(v, dt, v === hovered);
    for (const v of this.leaving) this.stepView(v, dt, false);
    this.stepSlots(dt);
    this.stepChromeFx(dt);
    this.stepTitle(dt);
    this.stepCombo(dt);
  };

  private stepView(v: CardView, dt: number, hovered: boolean): void {
    if (v.node.destroyed) return;
    v.lift = 0;
    if (v.motion) this.stepMotion(v, dt);
    // Inner transform belongs to hover/flip only while building; resolve beats own it otherwise.
    if (this.phase === 'building' && v.zone) {
      v.hover += ((hovered ? 1 : 0) - v.hover) * (1 - Math.exp(-dt / 45));
      const inHand = v.zone === 'hand';
      const s = 1 + (inHand ? 0.06 : 0.035) * v.hover;
      v.inner.scale.set(s * v.flipX, s);
      v.inner.position.set(0, -(inHand ? 14 : 6) * v.hover);
      v.inner.rotation = inHand ? -v.node.rotation * v.hover : 0.04 * v.hover;
      v.lift = Math.max(v.lift, 0.35 * v.hover);
    } else if (v.motion?.flip) {
      v.inner.scale.set(v.flipX, 1);
    }
    const h = v.lift;
    const sh = v.shadow;
    sh.position.set(v.node.x + 4 + 14 * h, v.node.y + 7 + 22 * h);
    sh.rotation = v.node.rotation;
    sh.scale.set(v.node.scale.x * v.inner.scale.x * (1 + 0.05 * h), v.node.scale.y * (1 + 0.05 * h));
    sh.alpha = (0.32 - 0.14 * h) * v.node.alpha;
  }

  private stepSlots(dt: number): void {
    const next = this.phase === 'building' && this.play.length < MAX_SLOTS ? this.play.length : -1;
    const k = 1 - Math.exp(-dt / 120);
    this.slotFrames.forEach((g, i) => {
      const filled = i < this.play.length && this.phase !== 'empty';
      const target =
        i === next ? 0.32 + 0.3 * (0.5 + 0.5 * Math.sin(this.clock / 260)) : filled ? 0.08 : 0.22;
      g.alpha += (target - g.alpha) * k;
      this.slotNums[i].alpha += ((i === next ? 0.7 : filled ? 0.1 : 0.35) - this.slotNums[i].alpha) * k;
    });
  }

  private addChromeFx(fn: ChromeFx): void {
    this.chromeFx.push({ t: 0, fn });
  }

  private stepChromeFx(dt: number): void {
    this.chromeG.clear();
    this.chromeFx = this.chromeFx.filter((it) => {
      it.t += dt;
      return it.fn(it.t, this.chromeG);
    });
  }

  /** Gold outline that blooms out from under a card as it lands in its slot. */
  private landingRing(at: Pose): void {
    this.addChromeFx((t, g) => {
      const life = 300;
      if (t >= life) return false;
      const k = t / life;
      const grow = 2 + 14 * ease.outCubic(k);
      g.roundRect(at.x - CARD_W / 2 - grow, at.y - CARD_H / 2 - grow, CARD_W + grow * 2, CARD_H + grow * 2, 10 + grow)
        .stroke({ color: GOLD, width: 3 * (1 - k) + 0.5, alpha: 0.75 * (1 - k) });
      return true;
    });
  }

  private setTitle(text: string): void {
    if (this.titleText.text === text) return;
    this.titleText.text = text;
    this.titlePop = 0;
  }

  private stepTitle(dt: number): void {
    if (this.titlePop >= 1) return;
    this.titlePop = Math.min(1, this.titlePop + dt / 200);
    const k = this.titlePop;
    this.titleText.scale.set(1 + 0.08 * (1 - ease.outCubic(k)));
    this.titleText.alpha = 0.4 + 0.6 * ease.outQuad(k);
  }

  private fadeOutLayer(layer: Container, ms: number): void {
    const kids = [...layer.children];
    if (!kids.length) return;
    const holder = new Container();
    kids.forEach((k) => holder.addChild(k));
    layer.addChild(holder);
    void this.tween(ms, (p) => {
      holder.alpha = 1 - p;
    }).then(() => holder.destroy({ children: true }));
  }

  // ——— Static board art ———

  private drawBackdrop(): void {
    const g = new Graphics();
    g.rect(0, 0, W, H).fill({ color: 0x2b2118 });
    g.ellipse(W * 0.5, H * 0.12, W * 0.55, 90).fill({ color: 0x4a3424, alpha: 0.35 });
    this.laneLayer.addChild(g);
  }

  private drawLaneGuides(): void {
    const g = new Graphics();
    for (const y of LANE_Y) {
      g.roundRect(36, y - CARD_H / 2 - 16, W - 72, CARD_H + 32, 10).fill({
        color: 0x3a2e22,
        alpha: 0.55,
      });
      g.roundRect(36, y - CARD_H / 2 - 16, W - 72, CARD_H + 32, 10).stroke({
        color: 0xf0c36a,
        width: 1,
        alpha: 0.18,
      });
    }
    const labelStyle = new TextStyle({
      fontFamily: 'Source Sans 3, sans-serif',
      fontSize: 12,
      fill: 0x8a7a68,
      letterSpacing: 2,
      fontWeight: '700',
    });
    const top = new Text({ text: 'AIR LANE', style: labelStyle });
    top.position.set(48, LANE_Y[1] - CARD_H / 2 - 10);
    const bot = new Text({ text: 'GROUND LANE', style: labelStyle });
    bot.position.set(48, LANE_Y[0] - CARD_H / 2 - 10);
    this.laneLayer.addChild(g, top, bot);
  }

  private drawHandRail(): void {
    const g = new Graphics();
    g.roundRect(36, HAND_Y - CARD_H / 2 - 20, W - 72, CARD_H + 40, 10).fill({
      color: 0x241a14,
      alpha: 0.85,
    });
    g.roundRect(36, HAND_Y - CARD_H / 2 - 20, W - 72, CARD_H + 40, 10).stroke({
      color: 0xf0c36a,
      width: 1,
      alpha: 0.22,
    });
    const label = new Text({
      text: 'HAND',
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 12,
        fill: 0x8a7a68,
        letterSpacing: 2,
        fontWeight: '700',
      }),
    });
    label.position.set(48, HAND_Y - CARD_H / 2 - 14);
    this.laneLayer.addChild(g, label);
  }

  private drawEmptySlots(): void {
    this.slotLayer.removeChildren();
    this.slotFrames = [];
    this.slotNums = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const x = SLOT_X[i];
      // ghost slot on bottom lane as the default landing visual
      const g = new Graphics();
      g.roundRect(x - CARD_W / 2, LANE_Y[0] - CARD_H / 2, CARD_W, CARD_H, 10).stroke({
        color: 0xf0c36a,
        width: 1.5,
      });
      g.alpha = 0.22;
      const n = new Text({
        text: String(i + 1),
        style: new TextStyle({
          fontFamily: 'Source Sans 3, sans-serif',
          fontSize: 18,
          fill: 0x8a7a68,
          fontWeight: '700',
        }),
      });
      n.anchor.set(0.5);
      n.position.set(x, LANE_Y[0]);
      n.alpha = 0.35;
      this.slotLayer.addChild(g, n);
      this.slotFrames.push(g);
      this.slotNums.push(n);
    }
  }

  private createView(card: CardDef, faceUp: boolean, at: Pose): CardView {
    const node = new Container();
    node.boundsArea = CARD_BOUNDS;
    node.hitArea = new Rectangle(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
    node.eventMode = 'static';
    const inner = new Container();
    const { face, badge } = this.makeCardFace(card);
    const back = this.makeCardBack();
    inner.addChild(face, back);
    node.addChild(inner);
    setPose(node, at);

    const shadow = new Graphics();
    shadow
      .roundRect(-CARD_W / 2 - 3, -CARD_H / 2 - 3, CARD_W + 6, CARD_H + 6, 13)
      .fill({ color: 0x000000, alpha: 0.45 })
      .roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10)
      .fill({ color: 0x000000, alpha: 0.55 });
    shadow.alpha = 0;
    this.shadowLayer.addChildAt(shadow, 0);

    const v: CardView = {
      card,
      node,
      inner,
      face,
      back,
      badge,
      shadow,
      faceUp,
      zone: null,
      target: null,
      motion: null,
      flipX: 1,
      hover: 0,
      lift: 0,
    };
    this.showFace(v, faceUp);
    node.on('pointertap', () => this.onTap(v));
    this.flyLayer.addChild(node);
    return v;
  }

  private makeCardFace(card: CardDef): { face: Container; badge: Text } {
    const c = new Container();
    const color = TYPE_COLORS[card.type];
    const body = new Graphics();
    body.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).fill({ color: 0x1a1410 });
    body.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).stroke({ color, width: 3 });
    body.roundRect(-CARD_W / 2 + 8, -CARD_H / 2 + 8, CARD_W - 16, 34, 6).fill({ color });

    const typeText = new Text({
      text: card.type,
      style: new TextStyle({
        fontFamily: 'Bebas Neue, Impact, sans-serif',
        fontSize: 40,
        fill: 0xf4ebe0,
        fontWeight: '700',
      }),
    });
    typeText.anchor.set(0.5);
    typeText.position.set(0, -18);

    const name = new Text({
      text: TYPE_NAMES[card.type],
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 12,
        fill: 0xf4ebe0,
        fontWeight: '700',
      }),
    });
    name.anchor.set(0.5);
    name.position.set(0, 8);

    const dmg = new Text({
      text: `${card.damage} dmg`,
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 15,
        fill: 0xc9b896,
        fontWeight: '600',
      }),
    });
    dmg.anchor.set(0.5);
    dmg.position.set(0, 36);

    const role = new Text({
      text: isLaneChanger(card.type) ? 'CHANGE' : 'KEEP',
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 11,
        fill: 0x8a7a68,
        letterSpacing: 1.5,
        fontWeight: '700',
      }),
    });
    role.anchor.set(0.5);
    role.position.set(0, 56);

    const badge = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 12,
        fill: 0xf0c36a,
        fontWeight: '700',
      }),
    });
    badge.anchor.set(0.5);
    badge.position.set(-CARD_W / 2 + 16, -CARD_H / 2 + 24);
    badge.visible = false;

    c.addChild(body, typeText, name, dmg, role, badge);
    return { face: c, badge };
  }

  private makeCardBack(): Container {
    const c = new Container();
    const body = new Graphics();
    body.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).fill({ color: 0x1a1410 });
    body.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).stroke({ color: 0xf0c36a, width: 2, alpha: 0.4 });
    const hatch = new Graphics();
    for (let y = -CARD_H / 2 + 12; y < CARD_H / 2 - 8; y += 14) {
      hatch.moveTo(-CARD_W / 2 + 10, y);
      hatch.lineTo(CARD_W / 2 - 10, y + 28);
      hatch.stroke({ width: 1, color: 0x3a2e22, alpha: 0.55 });
    }
    const mark = new Text({
      text: 'LT',
      style: new TextStyle({
        fontFamily: 'Bebas Neue, Impact, sans-serif',
        fontSize: 32,
        fill: 0x8a7a68,
        fontWeight: '700',
      }),
    });
    mark.anchor.set(0.5);
    c.addChild(body, hatch, mark);
    return c;
  }

  // ——— Resolve: lock beat, hop handoff, hop counter ———

  /** Commit beat: the line presses down left→right under a gold rim; upcoming cards dim until the chain reaches them. */
  private async lockIn(token: number): Promise<void> {
    const views = this.play.map((c) => this.views.get(c.id)!).filter(Boolean);
    for (const card of this.hand) {
      const v = this.views.get(card.id);
      if (!v?.target) continue;
      const to = { ...v.target, y: v.target.y + 26 };
      v.target = to;
      void this.startMotion(v, 'shift', to, { layer: this.handLayer, alpha: 0.4 });
    }
    const rims = views.map((v) => {
      const r = new Graphics();
      r.roundRect(-CARD_W / 2 - 2, -CARD_H / 2 - 2, CARD_W + 4, CARD_H + 4, 11).stroke({ color: GOLD, width: 3 });
      r.alpha = 0;
      v.inner.addChild(r);
      return r;
    });
    const stagger = 35;
    const beat = 150;
    const total = stagger * Math.max(0, views.length - 1) + beat;
    await this.tween(total, (p) => {
      const ms = p * total;
      views.forEach((v, i) => {
        const k = clamp((ms - i * stagger) / beat, 0, 1);
        const press = Math.sin(Math.PI * k);
        v.inner.position.set(0, 3 * press);
        v.inner.scale.set(1 - 0.03 * press);
        rims[i].alpha = k <= 0 ? 0 : 0.9 * (1 - k);
        if (i > 0) v.node.tint = lerpColor(0xffffff, DIM_TINT, ease.outQuad(k));
      });
    });
    rims.forEach((r) => r.destroy());
    views.forEach((v) => {
      v.inner.position.set(0, 0);
      v.inner.scale.set(1);
    });
    if (token !== this.animToken) return;
    await this.wait(60);
  }

  /**
   * Resolve travel = body+hit-stop hop attacks (see attacks.ts / research brief).
   * Stops after last valid link; illegal edge → Break/Snap.
   */
  private async animateChainTravel(
    unbrokenLinks: number,
    breakAt: number,
    token: number,
    opts?: ResolveOptions,
  ): Promise<void> {
    for (let i = 0; i < unbrokenLinks; i++) {
      if (token !== this.animToken) return;
      await this.playLinkAttack(i, token);
    }

    const cardsInChain = Math.min(unbrokenLinks + 1, this.playNodes.length);
    if (breakAt >= 0) {
      await this.playBreakEffect(breakAt, token);
      const unreached = this.playNodes.slice(cardsInChain + 1);
      void this.tween(200, (p) => unreached.forEach((n) => (n.alpha = lerp(1, 0.4, p))));
      if (token === this.animToken && opts?.onRecoil) {
        await this.recoilBurst(token);
        await opts.onRecoil();
      }
    } else if (this.playNodes.length === 1) {
      const node = this.playNodes[0];
      const baseY = node.y;
      await this.tween(160, (p) => {
        node.y = baseY - Math.sin(p * Math.PI) * 10;
        node.scale.set(1 + Math.sin(p * Math.PI) * 0.06);
      });
      node.y = baseY;
      node.scale.set(1);
    }
  }

  private attackContext(linkIndex: number, token: number, isBreak: boolean): AttackContext {
    const attacker = this.playNodes[linkIndex];
    const target = this.playNodes[linkIndex + 1];
    return {
      attacker,
      target,
      fxLayer: this.fxLayer,
      groundY: LANE_Y[0],
      airY: LANE_Y[1],
      aborted: () => token !== this.animToken,
      nudgeBoard: (dx: number, dy: number) => {
        this.root.position.set(dx, dy);
        window.clearTimeout(this.nudgeTimer);
        this.nudgeTimer = window.setTimeout(() => this.root.position.set(0, 0), 120);
      },
      onContact: () => {
        if (isBreak) {
          this.combo.shake = 1;
          this.combo.num.tint = DIM_TINT;
          return;
        }
        target.tint = 0xffffff;
        this.comboHit();
      },
    };
  }

  private async playLinkAttack(linkIndex: number, token: number): Promise<void> {
    if (token !== this.animToken) return;
    const fromCard = this.play[linkIndex];
    const toCard = this.play[linkIndex + 1];
    if (!fromCard || !toCard || !this.playNodes[linkIndex] || !this.playNodes[linkIndex + 1]) return;

    const hop = hopIdFor(fromCard.type, toCard.type);
    if (!hop) return;
    await playHopAttack(hop, this.attackContext(linkIndex, token, false));
  }

  /** Break / Snap interrupt — no success motif; then GM draws BREAK. */
  private async playBreakEffect(breakAt: number, token: number): Promise<void> {
    if (token !== this.animToken) return;
    if (!this.playNodes[breakAt] || !this.playNodes[breakAt + 1]) return;
    await playBreakSnap(this.attackContext(breakAt, token, true));
  }

  private buildCombo(): void {
    const node = new Container();
    const body = new Container();
    const numStyle = {
      fontFamily: 'Bebas Neue, Impact, sans-serif',
      fontSize: 52,
      fill: GOLD,
      dropShadow: { color: 0x000000, blur: 6, distance: 3, alpha: 0.55 },
    };
    const num = new Text({ text: '0', style: numStyle, resolution: 3 });
    num.anchor.set(0.5);
    const flash = new Text({ text: '0', style: { ...numStyle, fill: 0xffffff, dropShadow: false }, resolution: 3 });
    flash.anchor.set(0.5);
    flash.alpha = 0;
    const label = new Text({
      text: 'HOPS',
      style: {
        fontFamily: 'Source Sans 3, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 3,
        fill: 0xc9b896,
      },
      resolution: 3,
    });
    label.anchor.set(0.5);
    label.position.set(2, 30);
    body.addChild(num, flash, label);
    node.addChild(body);
    node.visible = false;
    this.hudLayer.addChild(node);
    this.combo = { node, body, num, flash, label, count: 0, punch: 0, shake: 0 };
  }

  private hideCombo(): void {
    const c = this.combo;
    if (!c) return;
    c.node.visible = false;
    c.count = 0;
    c.punch = 0;
    c.shake = 0;
  }

  /** Hop counter punches on every contact frame. */
  private comboHit(): void {
    const c = this.combo;
    c.count += 1;
    if (!c.node.visible) {
      c.node.visible = true;
      c.node.alpha = 1;
      c.node.position.set(COMBO_AT.x, COMBO_AT.y);
      c.node.scale.set(1);
      c.num.tint = 0xffffff;
    }
    c.num.text = String(c.count);
    c.flash.text = c.num.text;
    c.label.text = c.count === 1 ? 'HOP' : 'HOPS';
    c.punch = 1;
  }

  private stepCombo(dt: number): void {
    const c = this.combo;
    if (!c.node.visible) return;
    c.punch = Math.max(0, c.punch - dt / 190);
    c.shake = Math.max(0, c.shake - dt / 260);
    const p = c.punch * c.punch;
    c.body.scale.set(1 + 0.5 * p);
    c.body.rotation = 0.12 * p * (c.count % 2 ? 1 : -1);
    c.flash.alpha = p;
    c.body.x = Math.sin(this.clock / 18) * 6 * c.shake;
  }

  /** The hop counter flies to center and becomes the turn total. */
  private async scoreStamp(damage: number, damageMode: ResolveDamageMode, token: number): Promise<void> {
    if (token !== this.animToken) return;
    const c = this.combo;
    const text = damageMode === 'hops' ? (damage === 0 ? '0' : `+${damage}`) : `+${damage}`;
    const label = damageMode === 'hops' ? (damage === 1 ? 'HOP' : 'HOPS') : 'DAMAGE';
    if (c.node.visible) {
      const from = { x: c.node.x, y: c.node.y };
      await this.tween(240, (p) => {
        const e = ease.inOutCubic(p);
        c.node.position.set(lerp(from.x, STAMP_AT.x, e), lerp(from.y, STAMP_AT.y, e) - Math.sin(Math.PI * e) * 24);
        c.node.scale.set(lerp(1, 1.55, e));
      });
    } else {
      c.node.visible = true;
      c.node.position.set(STAMP_AT.x, STAMP_AT.y);
      c.node.alpha = 0;
      await this.tween(160, (p) => {
        c.node.alpha = p;
        c.node.scale.set(lerp(0.5, 1.55, ease.outBack(p)));
      });
    }
    if (token !== this.animToken) return;
    c.num.text = text;
    c.flash.text = text;
    c.label.text = label;
    c.num.tint = damage === 0 ? DIM_TINT : 0xffffff;
    c.shake = 0;
    c.punch = 1;

    const burst = new Graphics();
    this.hudLayer.addChildAt(burst, 0);
    const ring = this.tween(420, (p) => {
      const e = ease.outCubic(p);
      burst.clear();
      if (damage === 0) return;
      burst.circle(STAMP_AT.x, STAMP_AT.y, 24 + e * 130).stroke({ width: 4 * (1 - e) + 0.5, color: GOLD, alpha: 1 - e });
      burst.circle(STAMP_AT.x, STAMP_AT.y, 12 + e * 70).fill({ color: GOLD, alpha: 0.18 * (1 - e) });
    });
    await this.wait(560);
    await ring;
    burst.destroy();
    if (token !== this.animToken) return;
    const y0 = c.node.y;
    await this.tween(260, (p) => {
      c.node.alpha = 1 - ease.outQuad(p);
      c.node.y = y0 - 18 * p;
    });
    this.hideCombo();
  }

  private async recoilBurst(token: number): Promise<void> {
    if (token !== this.animToken) return;
    const label = new Text({
      text: '−1 recoil',
      style: new TextStyle({
        fontFamily: 'Bebas Neue, Impact, sans-serif',
        fontSize: 36,
        fill: 0xff6b5a,
        fontWeight: '700',
        dropShadow: { color: 0x000000, blur: 4, distance: 2, alpha: 0.5 },
      }),
      resolution: 2,
    });
    label.anchor.set(0.5);
    label.position.set(W / 2, 120);
    label.alpha = 0;
    this.hudLayer.addChild(label);
    await this.tween(300, (p) => {
      const e = ease.outQuad(p);
      label.alpha = Math.min(1, p * 3);
      label.scale.set(lerp(1.5, 1, ease.outBack(Math.min(1, p * 1.6))));
      label.x = W / 2 + Math.sin(p * 40) * 5 * (1 - p);
      label.y = 120 - e * 14;
    });
    await this.wait(220);
    await this.tween(140, (p) => (label.alpha = 1 - p));
    label.destroy();
  }

  // ——— GM ink: verdicts drawn on after resolve ———

  private inkPath(i: number): InkPath | null {
    const a = this.playNodes[i];
    const b = this.playNodes[i + 1];
    if (!a || !b) return null;
    const p0 = { x: a.x + CARD_W / 2 + 4, y: a.y };
    const p1 = { x: b.x - CARD_W / 2 - 4, y: b.y };
    const c = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 + (p1.y - p0.y) * 0.15 };
    return { p0, c, p1, seed: i * 2.3 + 0.7 };
  }

  /** Pressure ribbon from s0 to s1 along the path, with a dark under-stroke so it reads on the felt. */
  private drawInk(g: Graphics, ep: InkPath, s1: number, width: number, color: number, taper: boolean): void {
    if (s1 <= 0.001) return;
    const n = Math.max(4, Math.ceil(30 * s1));
    const left: number[] = [];
    const right: number[] = [];
    let head: Vec = ep.p0;
    let headW = 0;
    for (let i = 0; i <= n; i++) {
      const s = (s1 * i) / n;
      const p = inkAt(ep, s);
      const d = quadTangent(ep.p0, ep.c, ep.p1, s);
      const w = (width * inkPressure(s, ep.seed, taper)) / 2;
      left.push(p.x - d.y * w, p.y + d.x * w);
      right.push(p.x + d.y * w, p.y - d.x * w);
      head = p;
      headW = w;
    }
    const poly = [...left];
    for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
    const under = poly.map((v, i) => v + (i % 2 ? 2.5 : 1.5));
    g.poly(under).fill({ color: INK_SHADOW, alpha: 0.55 });
    g.circle(head.x + 1.5, head.y + 2.5, headW).fill({ color: INK_SHADOW, alpha: 0.55 });
    g.poly(poly).fill({ color, alpha: 0.95 });
    g.circle(head.x, head.y, headW).fill({ color, alpha: 0.95 });
  }

  private async inkStroke(ep: InkPath, to: number, ms: number, color: number, taper: boolean): Promise<Graphics> {
    const g = new Graphics();
    this.inkLayer.addChild(g);
    await this.tween(ms, (p) => {
      g.clear();
      const s = to * ease.inOutQuad(p);
      this.drawInk(g, ep, s, 5.5, color, taper);
      if (p < 1) {
        const nib = inkAt(ep, s);
        g.circle(nib.x, nib.y, 2.2).fill({ color: 0xfff4dc, alpha: 0.9 });
      }
    });
    return g;
  }

  /** Marker word written on left→right behind a wiping mask, with a nib riding the edge. */
  private async inkWord(
    text: string,
    at: Vec,
    color: number,
    size: number,
    ms: number,
    rot = rand(-0.07, 0.05),
  ): Promise<Container> {
    const word = new Container();
    word.position.set(at.x, at.y);
    word.rotation = rot;
    const t = new Text({
      text,
      style: {
        fontFamily: MARKER,
        fontSize: size,
        fill: color,
        stroke: { color: INK_SHADOW, width: 4, join: 'round' },
        padding: 8,
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    const mask = new Graphics();
    const nib = new Graphics();
    word.addChild(t, mask, nib);
    t.mask = mask;
    this.inkLayer.addChild(word);
    const w = t.width + 8;
    const h = t.height + 8;
    await this.tween(ms, (p) => {
      const x = -w / 2 + w * p;
      mask.clear().rect(-w / 2, -h / 2, w * p, h).fill({ color: 0xffffff });
      nib.clear();
      if (p < 1) nib.circle(x, Math.sin(p * 26) * size * 0.22, 2).fill({ color: 0xfff4dc, alpha: 0.85 });
    });
    t.mask = null;
    mask.destroy();
    nib.destroy();
    await this.tween(110, (p) => word.scale.set(1 + 0.14 * Math.sin(Math.PI * p)));
    return word;
  }

  /** Two fast slashes crossing at the dead link. */
  private async inkCross(at: Vec): Promise<void> {
    const g = new Graphics();
    this.inkLayer.addChild(g);
    const r = 15;
    const strokes = [-0.78 + rand(-0.12, 0.12), 0.82 + rand(-0.12, 0.12)].map((a) => ({
      a: { x: at.x - Math.cos(a) * r, y: at.y - Math.sin(a) * r },
      b: { x: at.x + Math.cos(a) * r * 1.1, y: at.y + Math.sin(a) * r * 1.1 },
    }));
    const draw = (upto: number) => {
      g.clear();
      strokes.forEach((s, i) => {
        const k = clamp(upto - i, 0, 1);
        if (k <= 0) return;
        const e = ease.outQuad(k);
        const end = { x: lerp(s.a.x, s.b.x, e), y: lerp(s.a.y, s.b.y, e) };
        g.moveTo(s.a.x + 1.5, s.a.y + 2.5)
          .lineTo(end.x + 1.5, end.y + 2.5)
          .stroke({ width: 7, color: INK_SHADOW, alpha: 0.55, cap: 'round' });
        g.moveTo(s.a.x, s.a.y).lineTo(end.x, end.y).stroke({ width: 6, color: INK_BREAK, alpha: 0.95, cap: 'round' });
      });
    };
    await this.tween(120, (p) => draw(p * 2));
    draw(2);
  }

  /** Lane-mismatch note under the X, e.g. "air ↛ G", so the lesson sticks. */
  private async inkMismatch(link: LinkInfo, at: Vec): Promise<void> {
    const lane = laneAfter(link.from) === 0 ? 'ground' : 'air';
    const style = {
      fontFamily: MARKER,
      fontSize: 14,
      fill: INK_NOTE,
      stroke: { color: INK_SHADOW, width: 4, join: 'round' as const },
      padding: 6,
    };
    const left = new Text({ text: lane, style, resolution: 2 });
    const arrow = new Text({ text: '→', style, resolution: 2 });
    const right = new Text({ text: link.to, style, resolution: 2 });
    const gap = 5;
    const total = left.width + arrow.width + right.width + gap * 2;
    left.position.set(-total / 2, -left.height / 2);
    arrow.position.set(left.x + left.width + gap, -arrow.height / 2);
    right.position.set(arrow.x + arrow.width + gap, -right.height / 2);
    const note = new Container();
    note.position.set(at.x, at.y);
    note.rotation = rand(-0.05, 0.05);
    const strike = new Graphics();
    note.addChild(left, arrow, right, strike);
    note.alpha = 0;
    this.inkLayer.addChild(note);
    await this.tween(140, (p) => {
      note.alpha = ease.outQuad(p);
      note.y = at.y + 6 * (1 - ease.outQuad(p));
    });
    const ax = arrow.x + arrow.width / 2;
    await this.tween(80, (p) => {
      strike.clear();
      const x0 = ax + 5;
      const y0 = -9;
      strike
        .moveTo(x0, y0)
        .lineTo(lerp(x0, ax - 5, p), lerp(y0, 8, p))
        .stroke({ width: 2.5, color: INK_BREAK, alpha: 0.95, cap: 'round' });
    });
  }

  /**
   * GM pen: each verdict is drawn along the chain in order — OK strokes run edge to edge, the BREAK
   * stroke dies at the gap under an X with the lane mismatch noted. Later links stay ghosted.
   */
  private async drawVerdictLinks(breakAt: number, token: number): Promise<void> {
    this.inkLayer.removeChildren();
    if (this.links.length === 0) return;

    const lastReveal = breakAt >= 0 ? breakAt : this.links.length - 1;
    const words: Promise<unknown>[] = [];

    for (let i = 0; i <= lastReveal; i++) {
      if (token !== this.animToken) return;
      const link = this.links[i];
      const ep = this.inkPath(i);
      if (!ep) continue;
      const mid = inkAt(ep, 0.5);

      if (breakAt === i || !link.valid) {
        await this.inkStroke(ep, 0.5, 110, INK_BREAK, false);
        if (token !== this.animToken) return;
        await this.inkCross(mid);
        this.inkNudge(mid);
        await this.inkWord('BREAK', { x: mid.x, y: mid.y - 34 }, INK_BREAK, 22, 150);
        if (token !== this.animToken) return;
        await this.inkMismatch(link, { x: mid.x, y: mid.y + 30 });
        break;
      }

      await this.inkStroke(ep, 1, 150, INK_OK, true);
      if (token !== this.animToken) return;
      const d = quadTangent(ep.p0, ep.c, ep.p1, 0.5);
      const up = d.x >= 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
      const off = 20 + 8 * Math.abs(up.x);
      // The next stroke starts while this OK is still being written.
      words.push(this.inkWord('OK', { x: mid.x + up.x * off, y: mid.y + up.y * off }, INK_OK, 19, 100));
    }
    await Promise.all(words);

    if (breakAt >= 0) {
      const ghost = new Graphics();
      for (let i = breakAt + 1; i < this.links.length; i++) {
        const ep = this.inkPath(i);
        if (!ep) continue;
        for (let s = 0; s < 1; s += 0.16) {
          const a = quad(ep.p0, ep.c, ep.p1, s);
          const b = quad(ep.p0, ep.c, ep.p1, Math.min(1, s + 0.09));
          ghost.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
        ghost.stroke({ width: 2, color: 0x8a7a68, alpha: 0.5, cap: 'round' });
      }
      ghost.alpha = 0;
      this.inkLayer.addChildAt(ghost, 0);
      await this.tween(200, (p) => (ghost.alpha = 0.6 * p));
    }
  }

  /** The GM taps the table on the X: the two cards of the dead link flinch apart. */
  private inkNudge(at: Vec): void {
    const near = this.playNodes.filter((n) => Math.abs(n.x - at.x) < CARD_W);
    const base = near.map((n) => n.x);
    void this.tween(160, (p) => {
      const k = Math.sin(Math.PI * p) * (1 - p) * 4;
      near.forEach((n, i) => (n.x = base[i] + Math.sign(n.x - at.x) * k));
    }).then(() => near.forEach((n, i) => (n.x = base[i])));
  }

  private tween(ms: number, fn: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - start) / ms);
        fn(p);
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
