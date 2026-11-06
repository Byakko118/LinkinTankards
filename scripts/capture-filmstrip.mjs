// Filmstrip of whole hops from the attack tester at slow-mo, tiled into one image per hop.
// usage: MEDIA_DIR=... [HOPS=GG,GK] [SPEED=0.1] [STEP=220] [FRAMES=18] node scripts/capture-filmstrip.mjs
import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR ?? ".";
const hops = (process.env.HOPS ?? "GG,GK,KA,KS,AA,AS,SG,SK,BREAK").split(",");
const speed = Number(process.env.SPEED ?? "0.1");
const step = Number(process.env.STEP ?? "220");
const frames = Number(process.env.FRAMES ?? "18");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:5173/tester.html?speed=${speed}`, { waitUntil: "networkidle" });
await page.waitForSelector('.hop-panel[data-hop="BREAK"] canvas');
await page.waitForTimeout(500);

for (const id of hops) {
  const stage = page.locator(`.hop-panel[data-hop="${id}"] .hop-stage`);
  await stage.scrollIntoViewIfNeeded();
  const shots = [];
  const t0 = Date.now();
  await stage.click();
  for (let i = 0; i < frames; i++) {
    const target = t0 + i * step;
    const wait = target - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const ms = Math.round((Date.now() - t0) * speed);
    shots.push({ ms, b64: (await stage.screenshot()).toString("base64") });
  }
  await page.waitForTimeout(1500);

  const sheet = await browser.newPage({ viewport: { width: 1500, height: 800 } });
  const cells = shots
    .map((s) => `<figure><img src="data:image/png;base64,${s.b64}"/><figcaption>${s.ms} ms</figcaption></figure>`)
    .join("");
  await sheet.setContent(`<html><body style="margin:0;background:#140e0a;font:600 13px sans-serif;color:#c9b896">
    <div style="padding:8px 10px;font-size:16px">${id} · ${speed}× slow-mo · game time</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;padding:4px">${cells}</div>
    <style>figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 4px}</style></body></html>`);
  await sheet.screenshot({ path: path.join(media, `film-${id.toLowerCase()}.png`), fullPage: true });
  await sheet.close();
}

await browser.close();
console.log("ok");
