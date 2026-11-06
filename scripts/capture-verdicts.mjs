import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });

// Building: no validity lines
await page.goto("http://localhost:5173/?demo=1", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(media, "gameplay-build-no-preview.png"), fullPage: true });

// Valid drawn verdicts (settled)
await page.goto("http://localhost:5173/?demo=1&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(6500);
await page.screenshot({ path: path.join(media, "gameplay-verdict-drawn-valid.png"), fullPage: true });

// Break drawn verdicts (settled)
await page.goto("http://localhost:5173/?demo=break&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
await page.screenshot({ path: path.join(media, "gameplay-verdict-drawn-break.png"), fullPage: true });

await page.goto("http://localhost:5173/?demo=break-sa&auto=resolve", { waitUntil: "networkidle" });
await page.waitForTimeout(5500);
await page.screenshot({ path: path.join(media, "gameplay-verdict-drawn-break-sa.png"), fullPage: true });

await browser.close();
console.log("ok");
