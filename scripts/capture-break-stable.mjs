import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

async function midResolveShot(url, outName, waitMs) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // don't use auto=resolve so we control timing
  await page.click("#btn-resolve");
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(media, outName), fullPage: true });
}

// G→A break: travel~150 + break~760 ≈ 910; shoot during hitBurst (~1100)
await midResolveShot("http://localhost:5173/?demo=break", "gameplay-break-mark-stable.png", 1100);

// S→A break after G→K→S: travel~450 + break~760 ≈ 1210; shoot during hitBurst (~1450)
await midResolveShot("http://localhost:5173/?demo=break-sa", "gameplay-break-sa-stable.png", 1450);

await browser.close();
console.log("ok");
