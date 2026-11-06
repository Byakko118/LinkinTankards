// Contact-frame captures from the attack tester (freeze N ms after each hop's contact).
// usage: MEDIA_DIR=... [FREEZE=20] [PREFIX=contact] node scripts/capture-contact.mjs
import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR ?? ".";
const freeze = process.env.FREEZE ?? "20";
const prefix = process.env.PREFIX ?? "contact";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 1 });

await page.goto(`http://localhost:5173/tester.html?freeze=${freeze}`, { waitUntil: "networkidle" });
await page.waitForSelector('.hop-panel[data-hop="BREAK"] canvas');
await page.waitForTimeout(600);
await page.click("#play-all");
await page.waitForTimeout(1500);

await page.screenshot({ path: path.join(media, `${prefix}-gallery.png`), fullPage: true });
for (const id of ["GG", "GK", "KA", "KS", "AA", "AS", "SG", "SK", "BREAK"]) {
  const stage = page.locator(`.hop-panel[data-hop="${id}"] .hop-stage`);
  await stage.screenshot({ path: path.join(media, `${prefix}-${id.toLowerCase()}.png`) });
}

await browser.close();
console.log("ok");
