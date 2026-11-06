// Contact frames inside real gameplay resolves: each shot freezes the Nth hop of a demo chain.
// usage: MEDIA_DIR=... [FREEZE=20] node scripts/capture-gameplay-contact.mjs
import { chromium } from "playwright";
import path from "node:path";

const media = process.env.MEDIA_DIR ?? ".";
const freeze = process.env.FREEZE ?? "20";

// [demo, contacts to let play first, file]
const shots = [
  ["keeps", 0, "gameplay-gg-shoulder-check.png"],
  ["1", 0, "gameplay-gk-uppercut-launch.png"],
  ["1", 1, "gameplay-ka-sky-handoff.png"],
  ["rebound", 1, "gameplay-ks-meteor-pin.png"],
  ["keeps", 3, "gameplay-aa-wing-clip.png"],
  ["1", 2, "gameplay-as-dive-bomb.png"],
  ["1", 3, "gameplay-sg-aftershock-plant.png"],
  ["rebound", 2, "gameplay-sk-rebound-spring.png"],
  ["break", 0, "gameplay-break-snap.png"],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });

for (const [demo, skip, file] of shots) {
  await page.goto(
    `http://localhost:5173/?demo=${demo}&auto=resolve&freeze=${freeze}&freezeSkip=${skip}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(800 + skip * 900);
  await page.locator("#board-host canvas").screenshot({ path: path.join(media, file) });
}

await browser.close();
console.log("ok");
