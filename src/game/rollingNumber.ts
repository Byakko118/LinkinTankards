import { CanvasTextMetrics, Container, Graphics, Text, TextStyle, TextStyleOptions } from 'pixi.js';

function outBack(t: number, c = 1.9): number {
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) + (((b >> s) & 0xff) - ((a >> s) & 0xff)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

interface Column {
  box: Container;
  clip: Graphics;
  cur: Text;
  next: Text;
  glyph: string;
  /** Roll progress; 1 = settled. */
  t: number;
  /** Pop-in progress for freshly grown columns; 1 = settled. */
  grow: number;
  x: number;
  tx: number;
}

/**
 * Odometer readout: every changed glyph rolls up in its own clipped column (400 → 500 turns only the
 * hundreds wheel), and columns added on the left grow in. Digits share one advance so the total never
 * jitters sideways. Texts are white and tinted with `color`, so `flash` can push the whole number to white.
 */
export class RollingNumber extends Container {
  color: number;
  flash = 0;
  private cols: Column[] = [];
  private shown = '';
  private readonly styleObj: TextStyle;
  private readonly digitAdv: number;
  private readonly travel: number;
  private readonly half: number;

  constructor(
    style: TextStyleOptions,
    color: number,
    private readonly rollMs = 170,
  ) {
    super();
    this.color = color;
    this.styleObj = new TextStyle({ ...style, fill: 0xffffff });
    const fs = Number(style.fontSize ?? 48);
    this.digitAdv = Math.max(...'0123456789'.split('').map((d) => this.measure(d)));
    this.travel = fs * 0.95;
    this.half = fs * 0.62;
  }

  get text(): string {
    return this.shown;
  }

  /** Jump without rolling (new turn, reset). */
  reset(text: string): void {
    for (const c of this.cols) c.box.destroy({ children: true });
    this.cols = [];
    this.shown = '';
    this.set(text, false);
  }

  set(text: string, animate = true): void {
    if (text === this.shown) return;
    const old = this.cols;
    const next: Column[] = [];
    // Align from the right so units stay over units when the number grows a digit.
    for (let i = 0; i < text.length; i++) {
      const fromRight = text.length - 1 - i;
      const reuse = old[old.length - 1 - fromRight];
      const glyph = text[i];
      if (reuse) {
        if (reuse.glyph !== glyph) this.roll(reuse, glyph, animate);
        next.push(reuse);
      } else {
        next.push(this.column(glyph, animate));
      }
    }
    for (let i = 0; i < old.length - text.length; i++) old[i].box.destroy({ children: true });
    this.cols = next;
    this.shown = text;
    this.layout(!animate);
  }

  update(dt: number): void {
    const tint = mix(this.color, 0xffffff, Math.min(1, Math.max(0, this.flash)));
    const k = 1 - Math.exp(-dt / 55);
    for (const c of this.cols) {
      if (c.t < 1) {
        c.t = Math.min(1, c.t + dt / this.rollMs);
        const e = outBack(c.t);
        c.cur.y = -e * this.travel;
        c.next.y = (1 - e) * this.travel;
        if (c.t >= 1) this.settle(c);
      }
      if (c.grow < 1) {
        c.grow = Math.min(1, c.grow + dt / 220);
        c.box.scale.set(Math.max(0, outBack(c.grow, 2.4)));
      }
      c.x += (c.tx - c.x) * k;
      c.box.x = c.x;
      c.cur.tint = tint;
      c.next.tint = tint;
    }
  }

  private measure(glyph: string): number {
    return CanvasTextMetrics.measureText(glyph, this.styleObj).width;
  }

  private advance(glyph: string): number {
    return /\d/.test(glyph) ? this.digitAdv : this.measure(glyph) * 0.92;
  }

  private makeText(glyph: string): Text {
    const t = new Text({ text: glyph, style: this.styleObj, resolution: 3 });
    t.anchor.set(0.5);
    return t;
  }

  private column(glyph: string, animate: boolean): Column {
    const box = new Container();
    const cur = this.makeText(glyph);
    const next = this.makeText('');
    next.visible = false;
    const clip = new Graphics();
    const w = this.advance(glyph) + 24;
    clip.rect(-w / 2, -this.half, w, this.half * 2 + 8).fill({ color: 0xffffff });
    box.addChild(cur, next, clip);
    box.mask = clip;
    this.addChild(box);
    const col: Column = { box, clip, cur, next, glyph, t: 1, grow: animate ? 0 : 1, x: 0, tx: 0 };
    if (animate) box.scale.set(0);
    return col;
  }

  private roll(c: Column, glyph: string, animate: boolean): void {
    if (c.t < 1) this.settle(c);
    c.glyph = glyph;
    if (!animate) {
      c.cur.text = glyph;
      return;
    }
    c.next.text = glyph;
    c.next.visible = true;
    c.next.y = this.travel;
    c.t = 0;
  }

  private settle(c: Column): void {
    c.t = 1;
    c.cur.text = c.glyph;
    c.cur.y = 0;
    c.next.visible = false;
  }

  private layout(snap: boolean): void {
    const advs = this.cols.map((c) => this.advance(c.glyph));
    let x = -advs.reduce((a, b) => a + b, 0) / 2;
    this.cols.forEach((c, i) => {
      c.tx = x + advs[i] / 2;
      if (snap || c.grow < 1) c.x = c.tx;
      c.box.x = c.x;
      x += advs[i];
    });
  }
}
