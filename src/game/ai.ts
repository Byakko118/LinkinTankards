import {
  CardDef,
  CardType,
  canConnect,
  chainLength,
  evaluateLinks,
  isLaneChanger,
} from './rules';
import { SeededRng } from './rng';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

export const SLIP_RATE: Record<AiDifficulty, number> = {
  easy: 0.3,
  normal: 0.15,
  hard: 0.05,
};

type SlipStyle = 'greedy_tail' | 'cross_keeper' | 'double_changer';

const STYLE_WEIGHTS: Record<SlipStyle, number> = {
  greedy_tail: 5,
  cross_keeper: 3,
  double_changer: 1,
};

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) {
      out.push([items[i], ...p]);
    }
  }
  return out;
}

function scoreLine(line: CardDef[]): number {
  return chainLength(evaluateLinks(line));
}

function tieBreak(a: CardDef[], b: CardDef[]): boolean {
  if (b.length === 0) return true;
  const changers = (line: CardDef[]) => line.filter((c) => isLaneChanger(c.type)).length;
  return changers(a) > changers(b);
}

export function bestLine(hand: CardDef[]): CardDef[] {
  let best: CardDef[] = [];
  let bestScore = -1;
  const n = hand.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset = hand.filter((_, i) => mask & (1 << i));
    for (const perm of permutations(subset)) {
      const s = scoreLine(perm);
      if (s > bestScore || (s === bestScore && tieBreak(perm, best))) {
        bestScore = s;
        best = perm;
      }
    }
  }
  return best;
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
  const perfect = bestLine(hand);
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
