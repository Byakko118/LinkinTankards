import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

await page.goto("http://localhost:5173/?demo=1&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(4500);
await page.screenshot({ path: path.join(media, "gameplay-directed-valid.png"), fullPage: true });

await page.goto("http://localhost:5173/?demo=break&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(4500);
await page.screenshot({ path: path.join(media, "gameplay-directed-break.png"), fullPage: true });

await browser.close();
console.log("ok", media);
