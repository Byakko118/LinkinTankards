// PvC UI screenshots for project media folder.
// usage: MEDIA_DIR=<abs path to media/pvc> node scripts/capture-pvc.mjs
import { chromium } from 'playwright';
import path from 'node:path';

const media = process.env.MEDIA_DIR;
if (!media) {
  console.error('Set MEDIA_DIR to the target media/pvc folder');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1050 }, deviceScaleFactor: 1 });

await page.goto('http://localhost:5173/pvc.html', { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(media, 'pvc-difficulty-select.png'), fullPage: true });

await page.locator('.diff-btn[data-diff="normal"]').click();
await page.locator('#btn-start').click();
await page.waitForSelector('#match-live:not(.hidden)', { timeout: 8000 });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(media, 'pvc-human-build.png'), fullPage: true });

const canvas = page.locator('#board-host canvas');
const box = await canvas.boundingBox();
if (box) {
  const handY = box.y + box.height * 0.82;
  await page.mouse.click(box.x + box.width * 0.35, handY);
  await page.waitForTimeout(120);
  await page.mouse.click(box.x + box.width * 0.5, handY);
  await page.waitForTimeout(120);
  await page.mouse.click(box.x + box.width * 0.65, handY);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(media, 'pvc-line-built.png'), fullPage: true });
}

await browser.close();
console.log('ok');
