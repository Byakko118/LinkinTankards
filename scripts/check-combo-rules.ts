import assert from 'node:assert/strict';
import { DAMAGE_UNIT, MAX_COMBO_DAMAGE, comboDamageFromLinks, streakSteps } from '../src/game/hopDamage';
import { bestLine, planAiLine } from '../src/game/ai';
import { CardDef, CardType, evaluateLinks, makeCard } from '../src/game/rules';
import { SeededRng } from '../src/game/rng';
import { HAND_SIZE, TavernPile, buildTavernDeck } from '../src/game/tavernDeck';

const line = (types: string): CardDef[] => [...types].map((t) => makeCard(t as CardType));
const dmg = (types: string) => comboDamageFromLinks(evaluateLinks(line(types)));
const u = (n: number) => n * DAMAGE_UNIT;

// Damage table (docs/deck-combo-balance.md): H + B ×100, hops before a break count.
assert.deepEqual(dmg('G'), { hops: 0, streak: 0, total: 0 });
assert.equal(dmg('GGKAA').total, u(4));
assert.deepEqual(dmg('GGGKA'), { hops: u(4), streak: u(1), total: u(5) });
assert.deepEqual(dmg('GKSKA'), { hops: u(4), streak: u(1), total: u(5) });
assert.deepEqual(dmg('GKSKS'), { hops: u(4), streak: u(2), total: u(6) });
assert.equal(dmg('SKSKS').total, MAX_COMBO_DAMAGE);
assert.equal(dmg('GGGGG').total, MAX_COMBO_DAMAGE);
assert.equal(dmg('AAAAA').total, MAX_COMBO_DAMAGE);
assert.deepEqual(dmg('SKSKG'), { hops: u(3), streak: u(2), total: u(5) });
assert.deepEqual(dmg('GAAA'), { hops: 0, streak: 0, total: 0 });

// Streak ordinals per link (drive the escalating hit-stop and the "+100" seals).
const steps = (types: string) => streakSteps(evaluateLinks(line(types)));
assert.deepEqual(steps('SKSKS'), [0, 1, 2, 3]);
assert.deepEqual(steps('GGGKA'), [0, 1, 0, 0]);
assert.deepEqual(steps('GGKAA'), [0, 0, 0, 0]);
assert.deepEqual(steps('SKSKG'), [0, 1, 2, 0]);

// Deck and hand.
const deck = buildTavernDeck();
assert.equal(deck.length, 20);
for (const t of ['G', 'A', 'S', 'K']) assert.equal(deck.filter((c) => c.type === t).length, 5);
assert.equal(HAND_SIZE, 6);

// Draw pile: 3 hands, then a 2-card remainder is drawn before the reshuffle; no card is lost or duplicated.
const pile = new TavernPile(new SeededRng(7));
for (let turn = 0; turn < 40; turn++) {
  const hand = pile.drawHand();
  assert.equal(hand.length, 6);
  assert.equal(new Set(hand.map((c) => c.id)).size, 6);
  assert.equal(pile.drawCount + pile.discardCount + 6, 20, `turn ${turn}: cards conserved`);
  pile.discardCards(hand);
}

// AI expert line is legal, <= 5 cards, and maximises H + B.
const rng = new SeededRng(11);
for (let i = 0; i < 300; i++) {
  const hand = new TavernPile(rng.fork(i)).drawHand();
  const best = bestLine(hand);
  const links = evaluateLinks(best);
  assert.ok(best.length >= 1 && best.length <= 5);
  assert.ok(links.every((l) => l.valid));
  const planned = planAiLine(hand, 'hard', rng);
  assert.ok(planned.length >= 1 && planned.length <= 5);
}

console.log('combo rules ok');
