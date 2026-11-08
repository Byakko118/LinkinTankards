// Streak resolve FX + hand-6 chrome frames under a paused clock, plus a real-time clip of the full juggle.
// usage: MEDIA_DIR=<abs path to media/streak-anim> node scripts/capture-streak-anim.mjs   (dev server on :5173)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const media = process.env.MEDIA_DIR;
if (!media) {
  console.error('Set MEDIA_DIR to the target media/streak-anim folder');
  process.exit(1);
}
fs.mkdirSync(media, { recursive: true });
const only = process.env.ONLY?.split(',');
const BASE = 'http://localhost:5173';
const T0 = new Date('2026-01-01T00:00:00Z').getTime();

const browser = await chromium.launch({ headless: true });

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

async function shoot(page, file) {
  await page.locator('#board-host canvas').screenshot({ path: path.join(media, file) });
  console.log('  ', file);
}

const shots = {
  /** Same 80 ms after contact: plain hop 1 (S→K) vs the 3rd streak hop (K→S) — longer white hold, rings, inverted star. */
  async contacts() {
    for (const [skip, file] of [
      [0, 'contact-plain-hop.png'],
      [1, 'contact-streak-1st.png'],
      [3, 'contact-streak-3rd.png'],
    ]) {
      const page = await pausedPage(`${BASE}/?demo=streak&auto=resolve&freeze=80&freezeSkip=${skip}`);
      await step(page, 4200);
      await shoot(page, file);
      await page.close();
    }
  },

  /** GM ink with streak seals, then the tally into the counter, then the score stamp. */
  async ink() {
    const page = await pausedPage(`${BASE}/?demo=streak&auto=resolve`);
    await step(page, 4300);
    await shoot(page, 'ink-seals-drawing.png');
    await step(page, 600);
    await shoot(page, 'ink-seals-written.png');
    await step(page, 450);
    await shoot(page, 'tally-6.png');
    await step(page, 900);
    await shoot(page, 'score-stamp-7.png');
    await page.close();
  },

  async press() {
    const page = await pausedPage(`${BASE}/?demo=streak-press&auto=resolve`);
    for (let i = 0; i < 80; i++) await step(page, 100);
    await shoot(page, 'press-run-settled.png');
    await page.close();
  },

  /** PvC deal: pips fill as cards land, then the full-hand glint runs along the rail. */
  async hand() {
    const page = await pausedPage(`${BASE}/pvc.html`, { width: 1100, height: 1220 });
    await step(page, 300);
    await page.locator('#btn-start').click();
    await step(page, 500);
    await shoot(page, 'hand6-deal-pips.png');
    await step(page, 450);
    await shoot(page, 'hand6-full-glint.png');
    await step(page, 900);
    await shoot(page, 'hand6-settled.png');
    await page.close();
  },

  /** Real-time clip of the S→K→S→K→S resolve (webm → mp4 when ffmpeg is available). */
  async clip() {
    const dir = path.join(media, '.video');
    const ctx = await browser.newContext({
      viewport: { width: 1100, height: 1000 },
      recordVideo: { dir, size: { width: 1100, height: 1000 } },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?demo=streak&auto=resolve`, { waitUntil: 'networkidle' });
    const box = await page.locator('#board-host canvas').boundingBox();
    await page.waitForTimeout(8500);
    const video = page.video();
    await ctx.close();
    const webm = await video.path();
    const mp4 = path.join(media, 'streak-juggle-resolve.mp4');
    try {
      const crop = `crop=${Math.round(box.width / 2) * 2}:${Math.round(box.height / 2) * 2}:${Math.round(box.x)}:${Math.round(box.y)}`;
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-vf', crop, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
      console.log('  ', path.basename(mp4));
    } catch {
      fs.copyFileSync(webm, mp4.replace(/\.mp4$/, '.webm'));
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
