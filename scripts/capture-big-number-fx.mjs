// Big-number FX (×100 scale): odometer tally, streak seals, score stamp, PvC HP header.
// usage: MEDIA_DIR=<abs path to media/big-number-fx> node scripts/capture-big-number-fx.mjs   (dev server on :5173)
//   ONLY=strip,frames,hp,clip   STRIP_FROM/STRIP_TO/STRIP_STEP (ms) for the frame strip
//   CHROME_PATH=<chrome.exe> when the bundled Playwright browser is not installed; FFMPEG=<ffmpeg.exe> if not on PATH
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const media = process.env.MEDIA_DIR;
if (!media) {
  console.error('Set MEDIA_DIR to the target media/big-number-fx folder');
  process.exit(1);
}
fs.mkdirSync(media, { recursive: true });
const only = process.env.ONLY?.split(',');
const BASE = 'http://localhost:5173';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const T0 = new Date('2026-01-01T00:00:00Z').getTime();

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });

async function pausedPage(url, viewport = { width: 1100, height: 1000 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1000);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-host canvas', { state: 'attached' });
  await page.waitForTimeout(400);
  return page;
}

async function step(page, ms) {
  for (let t = 0; t < ms; t += 16) await page.clock.runFor(Math.min(16, ms - t));
}

async function shoot(page, file, sel = '#board-host canvas') {
  await page.locator(sel).screenshot({ path: path.join(media, file) });
  console.log('  ', file);
}

/** Fake a fighter's HP straight into the DOM so the header can be checked at any value without playing. */
async function paintHp(page, side, hp, start = 2800, low = 500) {
  await page.evaluate(
    ({ side, hp, start, low }) => {
      const el = document.getElementById(`fighter-${side}`);
      document.getElementById(`hp-${side}`).textContent = String(hp);
      el.style.setProperty('--hp', String(hp / start));
      el.classList.toggle('low', hp > 0 && hp <= low);
    },
    { side, hp, start, low },
  );
}

/** Init script: deterministic Math.random / Date.now so PvC deals the same hands every run. */
function seededRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Date.now = () => 1767225600000;
}

/** Start, click the leftmost hand card `cards` times, lock in, and wait out the resolve + HP drain. */
async function playFirstTurn(page, cards, sleep) {
  await page.locator('#btn-start').click();
  await sleep(1800);
  const box = await page.locator('#board-host canvas').boundingBox();
  const k = box.width / 960;
  for (let n = 6; n > 6 - cards; n--) {
    const spread = Math.min(150, 760 / n);
    const x = 480 - (spread * (n - 1)) / 2;
    await page.mouse.click(box.x + x * k, box.y + 545 * k);
    await sleep(450);
  }
  await page.locator('#btn-commit').click();
  for (let t = 0; t < 11000; t += 100) await sleep(100);
}

const shots = {
  /** Dense strip of the S→K→S→K→S (700) resolve, for picking frames. */
  async strip() {
    const from = Number(process.env.STRIP_FROM ?? 1500);
    const to = Number(process.env.STRIP_TO ?? 9500);
    const every = Number(process.env.STRIP_STEP ?? 150);
    const dir = path.join(media, 'strip');
    fs.mkdirSync(dir, { recursive: true });
    const page = await pausedPage(`${BASE}/?demo=streak&auto=resolve`);
    await step(page, from);
    for (let t = from; t <= to; t += every) {
      await page.locator('#board-host canvas').screenshot({ path: path.join(dir, `t${String(t).padStart(5, '0')}.png`) });
      await step(page, every);
    }
    console.log('   strip', from, '→', to);
    await page.close();
  },

  /** Picked beats of the 700 juggle: hop roll, seals, tally rolls, stamp slam, jackpot hold. */
  async frames() {
    const beats = JSON.parse(process.env.BEATS ?? '[]');
    const page = await pausedPage(`${BASE}/?demo=streak&auto=resolve`);
    let at = 0;
    for (const [t, file] of beats) {
      await step(page, t - at);
      at = t;
      await shoot(page, file);
    }
    await page.close();
  },

  /** PvC header: full 2800, mid-fight, low-HP pulse at 500, and a big −700 pop in flight. */
  async hp() {
    const page = await pausedPage(`${BASE}/pvc.html`, { width: 1100, height: 1220 });
    await step(page, 300);
    await page.locator('#btn-start').click();
    await step(page, 1500);
    await shoot(page, 'hp-2800-full.png', '.hp-bar');
    await paintHp(page, 'player', 2100);
    await paintHp(page, 'cpu', 500);
    await step(page, 600);
    await shoot(page, 'hp-low-500.png', '.hp-bar');
    // Same markup popDelta() builds for a 700 hit.
    await page.evaluate(() => {
      const pop = document.createElement('span');
      pop.className = 'hp-pop hit max';
      pop.textContent = '−700';
      document.querySelector('#fighter-cpu .hp-pops').appendChild(pop);
    });
    await step(page, 300);
    await shoot(page, 'hp-pop-700.png', '.hp-bar');
    await page.close();
  },

  /** Headless scan for a match seed whose first turn (leftmost card × N) hits hard, for the PvC clip. */
  async seedscan() {
    const seeds = Number(process.env.SCAN_SEEDS ?? 40);
    const found = [];
    for (let seed = 1; seed <= seeds; seed++) {
      for (const cards of [5, 4, 3]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 1280 } });
        await page.clock.install({ time: T0 });
        await page.addInitScript(seededRandom, seed);
        await page.goto(`${BASE}/pvc.html`, { waitUntil: 'networkidle' });
        await playFirstTurn(page, cards, (ms) => page.clock.runFor(ms));
        const hp = Number(await page.locator('#hp-cpu').textContent());
        await page.close();
        if (hp <= 2300) found.push({ seed, cards, damage: 2800 - hp });
      }
    }
    found.sort((a, b) => b.damage - a.damage);
    console.log(JSON.stringify(found.slice(0, 8)));
  },

  /** Real-time PvC turn with a fixed seed (PVC_SEED, PVC_CARDS from seedscan): the stamp lands, then the HP header drains. */
  async pvc() {
    const dir = path.join(media, '.video');
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 1280 },
      recordVideo: { dir, size: { width: 1100, height: 1280 } },
    });
    const page = await ctx.newPage();
    await page.addInitScript(seededRandom, Number(process.env.PVC_SEED ?? 1));
    await page.goto(`${BASE}/pvc.html`, { waitUntil: 'networkidle' });
    await playFirstTurn(page, Number(process.env.PVC_CARDS ?? 5), (ms) => page.waitForTimeout(ms));
    console.log('   cpu hp after turn:', await page.locator('#hp-cpu').textContent());
    await page.waitForTimeout(1500);
    const video = page.video();
    await ctx.close();
    const webm = await video.path();
    const mp4 = path.join(media, 'pvc-turn-hp.mp4');
    try {
      execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
      console.log('  ', path.basename(mp4));
    } catch {
      fs.copyFileSync(webm, mp4.replace(/\.mp4$/, '.webm'));
      console.log('   (no ffmpeg) webm kept');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  },

  /** Real-time clip of the 700 juggle resolve (webm → mp4 when ffmpeg is available). */
  async clip() {
    const dir = path.join(media, '.video');
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 1000 },
      recordVideo: { dir, size: { width: 1100, height: 1000 } },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?demo=streak&auto=resolve`, { waitUntil: 'networkidle' });
    const box = await page.locator('#board-host canvas').boundingBox();
    await page.waitForTimeout(Number(process.env.CLIP_MS ?? 11000));
    const video = page.video();
    await ctx.close();
    const webm = await video.path();
    const mp4 = path.join(media, 'juggle-700-resolve.mp4');
    try {
      const crop = `crop=${Math.round(box.width / 2) * 2}:${Math.round(box.height / 2) * 2}:${Math.round(box.x)}:${Math.round(box.y)}`;
      execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-i', webm, '-vf', crop, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
      console.log('  ', path.basename(mp4));
    } catch {
      fs.copyFileSync(webm, mp4.replace(/\.mp4$/, '.webm'));
      console.log('   (no ffmpeg) webm kept');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  },
};

for (const [name, fn] of Object.entries(shots)) {
  if (only && !only.includes(name)) continue;
  console.log(name);
  await fn();
}
await browser.close();
console.log('ok');
