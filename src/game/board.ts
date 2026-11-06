import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from 'pixi.js';
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
  resolveChainDamage,
} from './rules';

const W = 960;
const H = 640;
const CARD_W = 108;
const CARD_H = 142;
const LANE_Y = [330, 180] as const; // bottom, top play lanes (headroom above air for overhead strikes)
const SLOT_X = [110, 280, 450, 620, 790];
const HAND_Y = 545;
const MAX_SLOTS = 5;

export type BoardPhase = 'empty' | 'building' | 'resolving' | 'resolved';

export interface BoardHudSnapshot {
  linksLabel: string;
  damageLabel: string;
  phase: BoardPhase;
  playCount: number;
  handCount: number;
}

type ChangeListener = () => void;

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
  private linkLayer = new Container();
  private playLayer = new Container();
  private handLayer = new Container();
  private fxLayer = new Container();
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

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.root);
    this.root.addChild(
      this.laneLayer,
      this.slotLayer,
      this.linkLayer,
      this.playLayer,
      this.handLayer,
      this.fxLayer,
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

  clear(): void {
    this.animToken += 1;
    this.hand = [];
    this.play = [];
    this.lanes = [];
    this.links = [];
    this.phase = 'empty';
    this.playNodes = [];
    this.playLayer.removeChildren();
    this.handLayer.removeChildren();
    this.linkLayer.removeChildren();
    this.fxLayer.removeChildren();
    this.titleText.text = 'Deal a hand to begin';
    this.hintText.text = '';
    this.drawEmptySlots();
    this.emit();
  }

  /** Deal into hand only — play line stays empty for the player to build. */
  dealToHand(cards: CardDef[]): BoardHudSnapshot {
    this.clear();
    this.hand = [...cards];
    this.phase = 'building';
    this.titleText.text = 'Build your chain';
    this.hintText.text = 'Click a hand card to play · click a played card to take it back';
    this.refreshHand();
    this.refreshPlay();
    this.emit();
    return this.snapshot;
  }

  /**
   * Demo helper: deal into hand, then auto-play the given order onto the line.
   * Remaining hand cards (if any) stay in hand.
   */
  dealAndPlay(handCards: CardDef[], playOrder: CardDef[]): BoardHudSnapshot {
    this.dealToHand(handCards);
    for (const card of playOrder) {
      const idx = this.hand.findIndex((c) => c.id === card.id);
      if (idx >= 0) this.playFromHand(idx);
    }
    return this.snapshot;
  }

  clearPlayLine(): void {
    if (this.phase !== 'building') return;
    this.hand = [...this.hand, ...this.play];
    this.play = [];
    this.refreshAll();
  }

  async resolve(): Promise<BoardHudSnapshot> {
    if (this.phase !== 'building' || this.play.length === 0) return this.snapshot;
    this.phase = 'resolving';
    this.emit();
    const token = ++this.animToken;
    const dmg = resolveChainDamage(this.play, this.links);
    const unbroken = chainLength(this.links);
    const breakAt = firstBreakIndex(this.links);

    // No pre-resolve validity glyphs — keep linkLayer empty until the verdict draw.
    this.linkLayer.removeChildren();
    this.fxLayer.removeChildren();

    // 1) travel + one break anim → 2) points → 3) draw-on OK/BREAK verdicts
    await this.animateChainTravel(unbroken, breakAt, token);
    if (token !== this.animToken) return this.snapshot;

    await this.hitBurst(dmg, token);
    if (token !== this.animToken) return this.snapshot;

    this.fxLayer.removeChildren();
    await this.drawVerdictLinks(breakAt, token);
    if (token !== this.animToken) return this.snapshot;

    this.phase = 'resolved';
    const breakNote = breakAt >= 0 ? ` · broke at ${this.play[breakAt].type}→${this.play[breakAt + 1].type}` : '';
    this.titleText.text = `Resolved · ${dmg} damage${breakNote}`;
    this.hintText.text = breakAt >= 0 ? 'Chain stopped at the broken link' : 'Full chain connected';
    this.emit();
    return this.snapshot;
  }

  private emit(): void {
    this.onChange?.();
  }

  private playFromHand(handIndex: number): void {
    if (this.phase !== 'building') return;
    if (handIndex < 0 || handIndex >= this.hand.length) return;
    if (this.play.length >= MAX_SLOTS) return;
    const [card] = this.hand.splice(handIndex, 1);
    this.play.push(card);
    this.refreshAll();
  }

  /** Return this play-line card and everything after it to hand (keeps earlier order intact). */
  private returnFromPlay(playIndex: number): void {
    if (this.phase !== 'building') return;
    if (playIndex < 0 || playIndex >= this.play.length) return;
    const removed = this.play.splice(playIndex);
    this.hand.push(...removed);
    this.refreshAll();
  }

  private refreshAll(): void {
    this.lanes = computeLanes(this.play);
    this.links = evaluateLinks(this.play);
    this.fxLayer.removeChildren();
    // Validity stays hidden until resolve — no OK/BREAK preview lines while building.
    this.linkLayer.removeChildren();
    this.refreshPlay();
    this.refreshHand();
    if (this.play.length === 0) {
      this.titleText.text = 'Build your chain';
    } else {
      this.titleText.text = this.play.map((c) => c.type).join(' → ');
    }
    this.emit();
  }

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
    const g = new Graphics();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const x = SLOT_X[i];
      // ghost slot on bottom lane as the default landing visual
      g.roundRect(x - CARD_W / 2, LANE_Y[0] - CARD_H / 2, CARD_W, CARD_H, 10).stroke({
        color: 0xf0c36a,
        width: 1.5,
        alpha: 0.22,
      });
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
      this.slotLayer.addChild(n);
    }
    this.slotLayer.addChildAt(g, 0);
  }

  private refreshHand(): void {
    this.handLayer.removeChildren();
    this.hand.forEach((card, i) => {
      const node = this.makeCardNode(card, { interactive: this.phase === 'building', badge: '' });
      node.position.set(this.handX(i, this.hand.length), HAND_Y);
      if (this.phase === 'building') {
        node.on('pointertap', () => this.playFromHand(i));
      }
      this.handLayer.addChild(node);
    });
  }

  private refreshPlay(): void {
    this.playLayer.removeChildren();
    this.playNodes = this.play.map((card, i) => {
      const lane = this.lanes[i] ?? 0;
      const node = this.makeCardNode(card, {
        interactive: this.phase === 'building',
        badge: String(i + 1),
      });
      node.position.set(SLOT_X[i], LANE_Y[lane]);
      if (this.phase === 'building') {
        node.on('pointertap', () => this.returnFromPlay(i));
      }
      this.playLayer.addChild(node);
      return node;
    });
    // dim unused slot numbers already drawn; fine as-is
  }

  private handX(index: number, count: number): number {
    const spread = Math.min(170, 700 / Math.max(count, 1));
    const total = spread * (count - 1);
    const start = W / 2 - total / 2;
    return start + index * spread;
  }

  private makeCardNode(
    card: CardDef,
    opts: { interactive: boolean; badge: string },
  ): Container {
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

    c.addChild(body, typeText, name, dmg, role);

    if (opts.badge) {
      const idx = new Text({
        text: opts.badge,
        style: new TextStyle({
          fontFamily: 'Source Sans 3, sans-serif',
          fontSize: 12,
          fill: 0xf0c36a,
          fontWeight: '700',
        }),
      });
      idx.anchor.set(0.5);
      idx.position.set(-CARD_W / 2 + 16, -CARD_H / 2 + 24);
      c.addChild(idx);
    }

    if (opts.interactive) {
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.hitArea = new Rectangle(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
      c.on('pointerover', () => c.scale.set(1.05));
      c.on('pointerout', () => c.scale.set(1));
    }

    return c;
  }

  private linkEndpoints(i: number): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    midX: number;
    midY: number;
  } | null {
    const a = this.playNodes[i];
    const b = this.playNodes[i + 1];
    if (!a || !b) return null;
    const x1 = a.x + CARD_W / 2 - 8;
    const y1 = a.y;
    const x2 = b.x - CARD_W / 2 + 8;
    const y2 = b.y;
    return {
      x1,
      y1,
      x2,
      y2,
      midX: (x1 + x2) / 2,
      midY: (y1 + y2) / 2,
    };
  }

  private sampleLinkPoint(
    ep: { x1: number; y1: number; x2: number; y2: number },
    t: number,
  ): { x: number; y: number } {
    const midX = (ep.x1 + ep.x2) / 2;
    const ctrlY = (ep.y1 + ep.y2) / 2 + (ep.y2 - ep.y1) * 0.15;
    const u = 1 - t;
    return {
      x: u * u * ep.x1 + 2 * u * t * midX + t * t * ep.x2,
      y: u * u * ep.y1 + 2 * u * t * ctrlY + t * t * ep.y2,
    };
  }

  /**
   * After points: sequentially draw each verdict along the chain
   * (stroke-on + fade-in OK/BREAK label). Stops after the first BREAK; later links stay ghosted.
   */
  private async drawVerdictLinks(breakAt: number, token: number): Promise<void> {
    this.linkLayer.removeChildren();
    if (this.links.length === 0) return;

    const lastReveal = breakAt >= 0 ? breakAt : this.links.length - 1;

    for (let i = 0; i <= lastReveal; i++) {
      if (token !== this.animToken) return;
      const link = this.links[i];
      const ep = this.linkEndpoints(i);
      if (!ep) continue;

      const isBreak = breakAt === i;
      const color = isBreak || !link.valid ? 0xa33b3b : 0x3d8b5f;
      const labelColor = isBreak || !link.valid ? 0xff6b5a : 0x3d8b5f;
      const labelText = isBreak || !link.valid ? 'BREAK' : 'OK';
      const width = 5;

      const stroke = new Graphics();
      this.linkLayer.addChild(stroke);

      const steps = 14;
      await this.tween(140, (p) => {
        stroke.clear();
        const drawn = Math.max(1, Math.floor(p * steps));
        let prev = this.sampleLinkPoint(ep, 0);
        for (let s = 1; s <= drawn; s++) {
          const pt = this.sampleLinkPoint(ep, s / steps);
          stroke.moveTo(prev.x, prev.y);
          stroke.lineTo(pt.x, pt.y);
          stroke.stroke({ width, color, alpha: 0.95 });
          prev = pt;
        }
        stroke.circle(ep.x1, ep.y1, 4).fill({ color, alpha: 0.95 });
        if (p > 0.92) stroke.circle(ep.x2, ep.y2, 4).fill({ color, alpha: 0.95 });
      });

      // Final clean stroke (avoids segmented look)
      stroke.clear();
      stroke.moveTo(ep.x1, ep.y1);
      stroke.quadraticCurveTo(ep.midX, ep.midY + (ep.y2 - ep.y1) * 0.15, ep.x2, ep.y2);
      stroke.stroke({ width, color, alpha: 0.95 });
      stroke.circle(ep.x1, ep.y1, 4).fill({ color, alpha: 0.95 });
      stroke.circle(ep.x2, ep.y2, 4).fill({ color, alpha: 0.95 });

      const label = new Text({
        text: labelText,
        style: new TextStyle({
          fontFamily: 'Source Sans 3, sans-serif',
          fontSize: 14,
          fill: labelColor,
          fontWeight: '700',
        }),
      });
      label.anchor.set(0.5);
      label.position.set(ep.midX, ep.midY - 16);
      label.alpha = 0;
      label.scale.set(0.7);
      this.linkLayer.addChild(label);

      await this.tween(90, (p) => {
        const e = 1 - (1 - p) ** 2;
        label.alpha = e;
        label.scale.set(0.7 + 0.3 * e);
      });

      if (isBreak) break;
    }

    // Faint ghosts past the break (no labels — verdict already delivered).
    if (breakAt >= 0) {
      const ghost = new Graphics();
      for (let i = breakAt + 1; i < this.links.length; i++) {
        const ep = this.linkEndpoints(i);
        if (!ep) continue;
        ghost.moveTo(ep.x1, ep.y1);
        ghost.quadraticCurveTo(ep.midX, ep.midY + (ep.y2 - ep.y1) * 0.15, ep.x2, ep.y2);
        ghost.stroke({ width: 2, color: 0x5a4a3a, alpha: 0.25 });
      }
      this.linkLayer.addChildAt(ghost, 0);
    }
  }

  /**
   * Resolve travel = body+hit-stop hop attacks (see attacks.ts / research brief).
   * Stops after last valid link; illegal edge → Break/Snap.
   */
  private async animateChainTravel(
    unbrokenLinks: number,
    breakAt: number,
    token: number,
  ): Promise<void> {
    for (let i = 0; i < unbrokenLinks; i++) {
      if (token !== this.animToken) return;
      await this.playLinkAttack(i, token);
    }

    const cardsInChain = Math.min(unbrokenLinks + 1, this.playNodes.length);
    for (let i = cardsInChain; i < this.playNodes.length; i++) {
      this.playNodes[i].alpha = 0.4;
    }

    if (breakAt >= 0) {
      await this.playBreakEffect(breakAt, token);
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

  private attackContext(linkIndex: number, token: number): AttackContext {
    const attacker = this.playNodes[linkIndex];
    const target = this.playNodes[linkIndex + 1];
    const origin = { x: this.root.x, y: this.root.y };
    return {
      attacker,
      target,
      fxLayer: this.fxLayer,
      groundY: LANE_Y[0],
      airY: LANE_Y[1],
      aborted: () => token !== this.animToken,
      nudgeBoard: (dx: number, dy: number) => {
        this.root.position.set(origin.x + dx, origin.y + dy);
        window.setTimeout(() => this.root.position.set(origin.x, origin.y), 120);
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
    await playHopAttack(hop, this.attackContext(linkIndex, token));
  }

  /** Break / Snap interrupt — no success motif; then GM draws BREAK. */
  private async playBreakEffect(breakAt: number, token: number): Promise<void> {
    if (token !== this.animToken) return;
    if (!this.playNodes[breakAt] || !this.playNodes[breakAt + 1]) return;
    await playBreakSnap(this.attackContext(breakAt, token));
  }

  private async hitBurst(damage: number, token: number): Promise<void> {
    if (token !== this.animToken) return;
    const burst = new Graphics();
    this.fxLayer.addChild(burst);
    const label = new Text({
      text: `+${damage}`,
      style: new TextStyle({
        fontFamily: 'Bebas Neue, Impact, sans-serif',
        fontSize: 64,
        fill: 0xf0c36a,
        dropShadow: { color: 0x000000, blur: 6, distance: 3, alpha: 0.55 },
      }),
    });
    label.anchor.set(0.5);
    label.position.set(W / 2, 220);
    label.alpha = 0;
    label.scale.set(0.4);
    this.fxLayer.addChild(label);

    await this.tween(400, (p) => {
      const e = 1 - (1 - p) ** 2;
      burst.clear();
      burst.circle(W / 2, 220, 20 + e * 140).stroke({ width: 4, color: 0xc45c26, alpha: 1 - e });
      burst.circle(W / 2, 220, 10 + e * 80).fill({ color: 0xf0c36a, alpha: 0.22 * (1 - e) });
      label.alpha = Math.min(1, p * 2);
      label.scale.set(0.4 + e * 0.8);
      label.y = 220 - e * 28;
    });

    await this.wait(300);
    label.destroy();
    burst.destroy();
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
