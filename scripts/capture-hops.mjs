import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

async function midShot(url, waitMs, name) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.click("#btn-resolve");
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(media, name), fullPage: true });
}

await midShot("http://localhost:5173/?demo=1", 250, "gameplay-hop-gk-uppercut.png");
await midShot("http://localhost:5173/?demo=keeps", 1280, "gameplay-hop-aa-wingclip.png");
await midShot("http://localhost:5173/?demo=break", 140, "gameplay-hop-break-snap.png");

await browser.close();
console.log("ok");
