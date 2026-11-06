import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

// 1) Hand-building UI — play two cards from hand onto the line
await page.goto("http://localhost:5173/?demo=hand", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("no canvas");
// Hand cards are centered near y≈545 in 640 canvas; scale to element box
const scaleX = box.width / 960;
const scaleY = box.height / 640;
const handY = box.y + 545 * scaleY;
// Five hand cards centered — click first two (leftmost of the five)
const handXs = [0, 1].map((i) => {
  const spread = Math.min(170, 700 / 5);
  const total = spread * 4;
  const start = 960 / 2 - total / 2;
  return box.x + (start + i * spread) * scaleX;
});
await page.mouse.click(handXs[0], handY);
await page.waitForTimeout(250);
// after first play, 4 remain — recompute
const handXs2 = (() => {
  const count = 4;
  const spread = Math.min(170, 700 / count);
  const total = spread * (count - 1);
  const start = 960 / 2 - total / 2;
  // click the new leftmost (was previously second card, now index 0)
  return box.x + start * scaleX;
})();
await page.mouse.click(handXs2, handY);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(media, "gameplay-hand-build.png"), fullPage: true });

// 2) Full resolve
await page.goto("http://localhost:5173/?demo=1&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(4200);
await page.screenshot({ path: path.join(media, "gameplay-resolve-full.png"), fullPage: true });

// 3) Break-stop mid-chain
await page.goto("http://localhost:5173/?demo=break&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(4800);
await page.screenshot({ path: path.join(media, "gameplay-resolve-break.png"), fullPage: true });

await browser.close();
console.log("ok", media);
