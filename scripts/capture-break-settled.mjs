import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

for (const [demo, name] of [
  ["break", "gameplay-break-settled.png"],
  ["break-sa", "gameplay-break-sa-settled.png"],
]) {
  await page.goto(`http://localhost:5173/?demo=${demo}&auto=resolve`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(media, name), fullPage: true });
}

await browser.close();
console.log("ok");
