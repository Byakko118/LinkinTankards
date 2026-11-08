import './style.css';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import {
  ATTACK_GALLERY,
  AttackContext,
  AttackGalleryItem,
  HopId,
  playBreakSnap,
  playHopAttack,
  setAttackFreezeOnContact,
  setAttackTimeScale,
} from '../game/attacks';
import { CardType, TYPE_COLORS, TYPE_NAMES, isLaneChanger, playLaneOf } from '../game/rules';

// 1:1 with the gameplay board (card size, slot spacing, lane gap) so tuning here carries over.
const W = 440;
const H = 455;
const CARD_W = 108;
const CARD_H = 142;
const GROUND_Y = 320;
const AIR_Y = 170;
const LEFT_X = 135;
const RIGHT_X = 305;

const galleryEl = document.getElementById('gallery');
const speedEl = document.getElementById('speed') as HTMLSelectElement | null;
const freezeEl = document.getElementById('freeze') as HTMLInputElement | null;
const streakEl = document.getElementById('streak') as HTMLSelectElement | null;
const playAllEl = document.getElementById('play-all') as HTMLButtonElement | null;
if (!galleryEl) throw new Error('Missing #gallery');

const params = new URLSearchParams(window.location.search);
const speedParam = params.get('speed');
if (speedEl && speedParam) {
  if (![...speedEl.options].some((o) => o.value === speedParam)) {
    speedEl.add(new Option(`${speedParam}×`, speedParam));
  }
  speedEl.value = speedParam;
}
if (freezeEl && params.has('freeze')) freezeEl.checked = true;
if (streakEl && params.has('streak')) streakEl.value = params.get('streak') ?? '0';

const FREEZE_MS = Number(params.get('freeze')) || 20;

function applyTuning(): void {
  setAttackTimeScale(Number(speedEl?.value ?? 1) || 1);
  setAttackFreezeOnContact(freezeEl?.checked ? FREEZE_MS : null);
}
applyTuning();
speedEl?.addEventListener('change', applyTuning);
freezeEl?.addEventListener('change', applyTuning);

function laneY(type: CardType): number {
  return playLaneOf(type) === 0 ? GROUND_Y : AIR_Y;
}

function makeCard(type: CardType, badge: string): Container {
  const c = new Container();
  const color = TYPE_COLORS[type];
  const body = new Graphics();
  body.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).fill({ color: 0x1a1410 });
  body.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).stroke({ color, width: 3 });
  body.roundRect(-CARD_W / 2 + 8, -CARD_H / 2 + 8, CARD_W - 16, 34, 6).fill({ color });

  const letter = new Text({
    text: type,
    style: new TextStyle({
      fontFamily: 'Bebas Neue, Impact, sans-serif',
      fontSize: 40,
      fill: 0xf4ebe0,
      fontWeight: '700',
    }),
  });
  letter.anchor.set(0.5);
  letter.position.set(0, -18);

  const name = new Text({
    text: TYPE_NAMES[type],
    style: new TextStyle({
      fontFamily: 'Source Sans 3, sans-serif',
      fontSize: 12,
      fill: 0xf4ebe0,
      fontWeight: '700',
    }),
  });
  name.anchor.set(0.5);
  name.position.set(0, 8);

  const role = new Text({
    text: isLaneChanger(type) ? 'CHANGE' : 'KEEP',
    style: new TextStyle({
      fontFamily: 'Source Sans 3, sans-serif',
      fontSize: 11,
      fill: 0x8a7a68,
      fontWeight: '700',
      letterSpacing: 1.5,
    }),
  });
  role.anchor.set(0.5);
  role.position.set(0, 44);

  const tag = new Text({
    text: badge,
    style: new TextStyle({
      fontFamily: 'Source Sans 3, sans-serif',
      fontSize: 12,
      fill: 0xf0c36a,
      fontWeight: '700',
    }),
  });
  tag.anchor.set(0.5);
  tag.position.set(-CARD_W / 2 + 20, -CARD_H / 2 + 24);

  c.addChild(body, letter, name, role, tag);
  return c;
}

function drawRails(layer: Container): void {
  const g = new Graphics();
  g.rect(0, 0, W, H).fill({ color: 0x2b2118 });
  for (const y of [AIR_Y, GROUND_Y]) {
    g.roundRect(12, y - CARD_H / 2 - 12, W - 24, CARD_H + 24, 8).fill({ color: 0x3a2e22, alpha: 0.5 });
  }
  layer.addChild(g);

  const style = new TextStyle({
    fontFamily: 'Source Sans 3, sans-serif',
    fontSize: 12,
    fill: 0x8a7a68,
    fontWeight: '700',
    letterSpacing: 2,
  });
  const air = new Text({ text: 'AIR', style });
  air.position.set(22, AIR_Y - CARD_H / 2 - 8);
  const ground = new Text({ text: 'GROUND', style });
  ground.position.set(22, GROUND_Y - CARD_H / 2 - 8);
  layer.addChild(air, ground);
}

function resetCard(c: Container, x: number, y: number): void {
  c.position.set(x, y);
  c.scale.set(1);
  c.rotation = 0;
  c.alpha = 1;
}

interface PanelRuntime {
  item: AttackGalleryItem;
  root: Container;
  attacker: Container;
  target: Container;
  fxLayer: Container;
  token: number;
  current: Promise<void> | null;
  panel: HTMLElement;
  button: HTMLButtonElement;
}

const panels: PanelRuntime[] = [];

async function createPanel(item: AttackGalleryItem): Promise<PanelRuntime> {
  const panel = document.createElement('article');
  panel.className = 'hop-panel';
  panel.dataset.hop = item.id;
  panel.tabIndex = 0;
  panel.innerHTML = `
    <header>
      <div class="hop-id">${item.from} → ${item.to}${item.id === 'BREAK' ? ' · illegal' : ''}</div>
      <h2>${item.name}</h2>
      <p class="blurb">${item.blurb}</p>
    </header>
    <div class="hop-stage"></div>
    <button type="button" class="replay">Replay</button>
  `;
  galleryEl!.appendChild(panel);

  const stageHost = panel.querySelector('.hop-stage') as HTMLElement;
  const button = panel.querySelector('.replay') as HTMLButtonElement;

  const app = new Application();
  await app.init({
    width: W,
    height: H,
    background: 0x2b2118,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  stageHost.replaceChildren(app.canvas);

  const root = new Container();
  const laneLayer = new Container();
  const cardLayer = new Container();
  const fxLayer = new Container();
  app.stage.addChild(root);
  root.addChild(laneLayer, cardLayer, fxLayer);
  drawRails(laneLayer);

  const attacker = makeCard(item.from, 'ATK');
  const target = makeCard(item.to, 'TGT');
  attacker.position.set(LEFT_X, laneY(item.from));
  target.position.set(RIGHT_X, laneY(item.to));
  cardLayer.addChild(attacker, target);

  const runtime: PanelRuntime = {
    item,
    root,
    attacker,
    target,
    fxLayer,
    token: 0,
    current: null,
    panel,
    button,
  };

  panel.addEventListener('click', () => void playPanel(runtime));
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    void playPanel(runtime);
  });

  return runtime;
}

async function playPanel(rt: PanelRuntime): Promise<void> {
  const token = ++rt.token;
  // Let an aborted run restore its cards before the new one reads their slot poses.
  if (rt.current) await rt.current;
  if (token !== rt.token) return;

  rt.panel.classList.add('playing');
  rt.button.textContent = 'Playing…';
  rt.fxLayer.removeChildren();
  resetCard(rt.attacker, LEFT_X, laneY(rt.item.from));
  resetCard(rt.target, RIGHT_X, laneY(rt.item.to));
  rt.root.position.set(0, 0);

  const ctx: AttackContext = {
    attacker: rt.attacker,
    target: rt.target,
    fxLayer: rt.fxLayer,
    groundY: GROUND_Y,
    airY: AIR_Y,
    streak: Number(streakEl?.value ?? 0) || 0,
    aborted: () => token !== rt.token,
    nudgeBoard: (dx: number, dy: number) => {
      if (token === rt.token) rt.root.position.set(dx, dy);
    },
  };

  const run = (async () => {
    if (rt.item.id === 'BREAK') await playBreakSnap(ctx);
    else await playHopAttack(rt.item.id as HopId, ctx);
  })();
  rt.current = run;
  try {
    await run;
  } finally {
    if (rt.current === run) rt.current = null;
    if (token === rt.token) {
      resetCard(rt.attacker, LEFT_X, laneY(rt.item.from));
      resetCard(rt.target, RIGHT_X, laneY(rt.item.to));
      rt.root.position.set(0, 0);
      rt.panel.classList.remove('playing');
      rt.button.textContent = 'Replay';
    }
  }
}

playAllEl?.addEventListener('click', () => {
  for (const rt of panels) void playPanel(rt);
});

for (const item of ATTACK_GALLERY) {
  panels.push(await createPanel(item));
}
