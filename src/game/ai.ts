import { CardDef, CardType, canConnect, evaluateLinks, isLaneChanger } from './rules';
import { MAX_LINE, hopDamageFromLinks } from './hopDamage';
import { SeededRng } from './rng';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

export const SLIP_RATE: Record<AiDifficulty, number> = {
  easy: 0.3,
  normal: 0.15,
  hard: 0.05,
};

/** Share of turns the CPU ignores Streak and plays a random longest legal line instead. */
export const STREAK_MISS_RATE: Record<AiDifficulty, number> = {
  easy: 0.5,
  normal: 0.25,
  hard: 0.1,
};

type SlipStyle = 'greedy_tail' | 'cross_keeper' | 'double_changer';

const STYLE_WEIGHTS: Record<SlipStyle, number> = {
  greedy_tail: 5,
  cross_keeper: 3,
  double_changer: 1,
};

/** Every fully legal line of 1–MAX_LINE cards (a hand of 6 yields a few hundred). */
function legalLines(hand: readonly CardDef[]): CardDef[][] {
  const out: CardDef[][] = [];
  const line: CardDef[] = [];
  const used = new Set<string>();
  const extend = (): void => {
    for (const card of hand) {
      if (used.has(card.id)) continue;
      if (line.length > 0 && !canConnect(line[line.length - 1].type, card.type)) continue;
      line.push(card);
      used.add(card.id);
      out.push([...line]);
      if (line.length < MAX_LINE) extend();
      line.pop();
      used.delete(card.id);
    }
  };
  extend();
  return out;
}

function lineDamage(line: CardDef[]): number {
  return hopDamageFromLinks(evaluateLinks(line));
}

function tieBreak(a: CardDef[], b: CardDef[]): boolean {
  if (b.length === 0) return true;
  const changers = (line: CardDef[]) => line.filter((c) => isLaneChanger(c.type)).length;
  return changers(a) > changers(b);
}

/** Highest H + B among legal lines; unbroken lines always beat a break (which also costs recoil). */
export function bestLine(hand: CardDef[]): CardDef[] {
  let best: CardDef[] = [];
  let bestScore = -1;
  for (const line of legalLines(hand)) {
    const s = lineDamage(line);
    if (s > bestScore || (s === bestScore && tieBreak(line, best))) {
      bestScore = s;
      best = line;
    }
  }
  return best;
}

/** Streak miss: lane-correct but combo-blind, so a random longest legal line. */
function longestLegalLine(hand: CardDef[], rng: SeededRng): CardDef[] {
  const lines = legalLines(hand);
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  const pool = lines.filter((l) => l.length === longest);
  return pool[rng.nextInt(pool.length)] ?? [];
}

function firstBreakAt(line: CardDef[]): number {
  const links = evaluateLinks(line);
  return links.findIndex((l) => !l.valid);
}

function hasBreakAfterValidHop(line: CardDef[]): boolean {
  const breakAt = firstBreakAt(line);
  if (breakAt < 0) return false;
  return breakAt >= 1;
}

function pickSlipStyle(rng: SeededRng): SlipStyle {
  const total = Object.values(STYLE_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (const [style, w] of Object.entries(STYLE_WEIGHTS) as [SlipStyle, number][]) {
    r -= w;
    if (r <= 0) return style;
  }
  return 'greedy_tail';
}

function illegalCrossKeeper(from: CardType, hand: CardDef[]): CardType | null {
  const illegal: CardType = from === 'G' ? 'A' : from === 'A' ? 'G' : from;
  if (from !== 'G' && from !== 'A') return null;
  const has = hand.some((c) => c.type === illegal);
  return has ? illegal : null;
}

function applyGreedyTail(best: CardDef[], hand: CardDef[]): CardDef[] | null {
  if (best.length >= MAX_LINE) return null;
  const used = new Set(best.map((c) => c.id));
  const extras = hand.filter((c) => !used.has(c.id));
  for (const extra of extras) {
    const candidate = [...best, extra];
    if (firstBreakAt(candidate) === best.length) return candidate;
  }
  return null;
}

function applyCrossKeeper(best: CardDef[], hand: CardDef[]): CardDef[] | null {
  if (best.length < 2) return null;
  for (let i = 1; i < best.length; i++) {
    const from = best[i - 1].type;
    const illegal = illegalCrossKeeper(from, hand);
    if (!illegal) continue;
    const repl = hand.find((c) => c.type === illegal && c.id !== best[i].id);
    if (!repl) continue;
    const candidate = [...best];
    candidate[i] = repl;
    if (firstBreakAt(candidate) === i && hasBreakAfterValidHop(candidate)) return candidate;
  }
  return null;
}

function applyDoubleChanger(best: CardDef[], hand: CardDef[]): CardDef[] | null {
  for (const type of ['K', 'S'] as CardType[]) {
    for (let i = 1; i < best.length; i++) {
      if (best[i - 1].type !== type) continue;
      const repl = hand.find((c) => c.type === type && c.id !== best[i].id);
      if (!repl) continue;
      const candidate = [...best];
      candidate[i] = repl;
      if (!canConnect(candidate[i - 1].type, candidate[i].type)) {
        if (hasBreakAfterValidHop(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function planAiLine(hand: CardDef[], difficulty: AiDifficulty, rng: SeededRng): CardDef[] {
  const missesStreak = rng.next() < STREAK_MISS_RATE[difficulty];
  const perfect = missesStreak ? longestLegalLine(hand, rng) : bestLine(hand);
  if (perfect.length === 0) return perfect;

  const rate = SLIP_RATE[difficulty];
  if (rng.next() >= rate) return perfect;

  const style = pickSlipStyle(rng);
  const slipped =
    style === 'greedy_tail'
      ? applyGreedyTail(perfect, hand)
      : style === 'cross_keeper'
        ? applyCrossKeeper(perfect, hand)
        : applyDoubleChanger(perfect, hand);

  if (!slipped || !hasBreakAfterValidHop(slipped)) return perfect;
  return slipped;
}
