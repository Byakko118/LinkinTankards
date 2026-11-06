import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

async function midShot(url, waitMs, name) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.click("#btn-resolve");
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(media, name), fullPage: true });
}

// demo=1: G→K, K→A, A→S, S→G
await midShot("http://localhost:5173/?demo=1", 220, "gameplay-attack-g-k.png");
await midShot("http://localhost:5173/?demo=1", 780, "gameplay-attack-k-a.png");
await midShot("http://localhost:5173/?demo=1", 1400, "gameplay-attack-a-s.png");
await midShot("http://localhost:5173/?demo=1", 1950, "gameplay-attack-s-g.png");

// keeps: G→G early, A→A later
await midShot("http://localhost:5173/?demo=keeps", 200, "gameplay-attack-g-g.png");
await midShot("http://localhost:5173/?demo=keeps", 1750, "gameplay-attack-a-a.png");

await browser.close();
console.log("ok");
