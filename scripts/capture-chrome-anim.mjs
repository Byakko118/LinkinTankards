// Chrome animation frames (deal, place, peel, lock beat, contact handoff, GM ink, HP/UI) under a paused clock.
// usage: MEDIA_DIR=<abs path to media/chrome-anim> node scripts/capture-chrome-anim.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const media = process.env.MEDIA_DIR;
if (!media) {
  console.error('Set MEDIA_DIR to the target media/chrome-anim folder');
  process.exit(1);
}
fs.mkdirSync(media, { recursive: true });
const only = process.env.ONLY?.split(',');
const BASE = 'http://localhost:5173';
const T0 = new Date('2026-01-01T00:00:00Z').getTime();

const browser = await chromium.launch({ headless: true });

async function pausedPage(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1000);
  return page;
}

/** Real time keeps loading fonts/modules; the page clock (rAF, timers, performance.now) stays frozen. */
async function boot(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-host canvas', { state: 'attached' });
  await page.waitForTimeout(400);
}

async function shoot(page, file, target = '#board-host canvas') {
  await page.locator(target).screenshot({ path: path.join(media, file) });
  console.log('  ', file);
}

/** Advance the frozen page clock in rAF-sized steps so every tween sees each frame. */
async function step(page, ms) {
  for (let t = 0; t < ms; t += 16) await page.clock.runFor(Math.min(16, ms - t));
}

async function canvasPoint(page, x, y) {
  const box = await page.locator('#board-host canvas').boundingBox();
  const s = box.width / 960;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function tapBoard(page, x, y) {
  const p = await canvasPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const handX = (i, n) => {
  const spread = Math.min(170, 700 / n);
  return 480 - (spread * (n - 1)) / 2 + i * spread;
};
const handY = (i, n) => 545 + (i - (n - 1) / 2) ** 2 * 2.4;

async function lineCount(page) {
  const t = await page.locator('#links-value').textContent();
  const m = /(\d+) cards? on the line/.exec(t ?? '');
  return m ? Number(m[1]) : 0;
}

/** Click the play-line card in slot i, whichever lane it sits in. */
async function tapSlot(page, i) {
  const before = await lineCount(page);
  const x = [110, 280, 450, 620, 790][i];
  await tapBoard(page, x, 330);
  if ((await lineCount(page)) === before) await tapBoard(page, x, 180);
}

const shots = {
  async pvcBuild() {
    const page = await pausedPage({ width: 1100, height: 1220 });
    await boot(page, `${BASE}/pvc.html`);
    await step(page, 400);
    await shoot(page, 'ui-difficulty-normal.png', '#match-setup');
    await page.locator('.diff-btn[data-diff="hard"]').click();
    await step(page, 110);
    await shoot(page, 'ui-difficulty-slide.png', '#match-setup');
    await step(page, 500);
    await shoot(page, 'ui-difficulty-hard.png', '#match-setup');

    await page.locator('#btn-start').click();
    await step(page, 300);
    await shoot(page, 'deal-midflight.png');
    await step(page, 200);
    await shoot(page, 'deal-flip.png');
    await step(page, 900);
    await shoot(page, 'ui-match-start.png', '#pvc-app');

    const hp = await canvasPoint(page, handX(1, 5), handY(1, 5));
    await page.mouse.move(hp.x, hp.y);
    await step(page, 300);
    await shoot(page, 'hand-hover.png');

    await tapBoard(page, handX(0, 5), handY(0, 5));
    await step(page, 140);
    await shoot(page, 'place-midflight.png');
    await step(page, 190);
    await shoot(page, 'place-landing.png');
    await step(page, 500);
    await tapBoard(page, handX(0, 4), handY(0, 4));
    await step(page, 700);
    await tapBoard(page, handX(0, 3), handY(0, 3));
    await step(page, 700);
    await page.mouse.move(5, 5);
    await step(page, 200);
    await shoot(page, 'line-built.png');

    await tapSlot(page, 1);
    await step(page, 150);
    await shoot(page, 'peel-midflight.png');
    await step(page, 900);
    await shoot(page, 'peel-returned.png');
    await page.close();
  },

  async pvcTurn() {
    const page = await pausedPage({ width: 1100, height: 1220 });
    await boot(page, `${BASE}/pvc.html`);
    await page.locator('#btn-start').click();
    await step(page, 1400);
    for (let n = 5; n > 1; n--) {
      await tapBoard(page, handX(0, n), handY(0, n));
      await step(page, 600);
    }
    await shoot(page, 'ui-ready-to-lock.png', '.hud');
    await page.locator('#btn-commit').click();
    await step(page, 130);
    await shoot(page, 'lock-in.png');
    // Let the resolve play, then freeze on the first HP pop.
    for (let i = 0; i < 400 && !(await page.locator('.hp-pop').count()); i++) await step(page, 32);
    await step(page, 140);
    await shoot(page, 'ui-hp-hit.png', '.hp-bar');
    await step(page, 700);
    await shoot(page, 'ui-hp-ghost-trail.png', '.hp-bar');
    for (let i = 0; i < 300 && !(await page.locator('.turn-banner.cpu').count()); i++) await step(page, 32);
    await step(page, 120);
    await shoot(page, 'ui-banner-cpu.png', '#pvc-app');
    for (let i = 0; i < 400 && (await lineCount(page)) < 1; i++) await step(page, 16);
    await step(page, 150);
    await shoot(page, 'cpu-place-flip.png');
    await page.close();
  },

  async inkFull() {
    const page = await pausedPage({ width: 1100, height: 1000 });
    await boot(page, `${BASE}/?demo=1&auto=resolve`);
    await step(page, 120);
    await shoot(page, 'lock-in-demo.png');
    await step(page, 470);
    await shoot(page, 'handoff-contact-1.png');
    await step(page, 1240 - 590);
    await shoot(page, 'handoff-contact-2.png');
    for (let t = 0; t < 3200; t += 100) await step(page, 100);
    await shoot(page, 'ink-ok-chain.png');
    await page.close();
  },

  async inkBreak() {
    const page = await pausedPage({ width: 1100, height: 1000 });
    await boot(page, `${BASE}/?demo=break-sa&auto=resolve`);
    await step(page, 2300);
    await shoot(page, 'ink-break-drawing.png');
    await step(page, 500);
    await shoot(page, 'ink-break-written.png');
    await step(page, 1350);
    await shoot(page, 'ink-break-stamp.png');
    await step(page, 1000);
    await shoot(page, 'ink-break-settled.png');
    await page.close();
  },
};

for (const [name, fn] of Object.entries(shots)) {
  if (only && !only.includes(name)) continue;
  console.log(name);
  await fn();
}
await browser.close();
console.log('ok');
