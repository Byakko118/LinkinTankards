import { CardType, LinkInfo, chainLength } from './rules';

/** Longest line a player may build (max 4 hops). */
export const MAX_LINE = 5;

export interface ComboDamage {
  /** Legal hops before the first break (1 HP each). */
  hops: number;
  /** +1 per hop that repeats the previous hop's kind (G→G, A→A, S↔K). */
  streak: number;
  /** hops + streak. */
  total: number;
}

type HopKind = 'press-G' | 'press-A' | 'juggle' | 'other';

function hopKind(from: CardType, to: CardType): HopKind {
  if (from === 'G' && to === 'G') return 'press-G';
  if (from === 'A' && to === 'A') return 'press-A';
  if ((from === 'S' && to === 'K') || (from === 'K' && to === 'S')) return 'juggle';
  return 'other';
}

/**
 * Per link: 0 when the hop pays no Streak (or never lands), else its ordinal among the line's
 * streak hops (1st, 2nd, 3rd). Only the unbroken prefix can score.
 */
export function streakSteps(links: readonly LinkInfo[]): number[] {
  const hops = chainLength(links);
  const steps = links.map(() => 0);
  let n = 0;
  let prev: HopKind = 'other';
  for (let i = 0; i < hops; i++) {
    const kind = hopKind(links[i].from, links[i].to);
    if (kind !== 'other' && kind === prev) steps[i] = ++n;
    prev = kind;
  }
  return steps;
}

/** PvC combat: H + B over the unbroken prefix. Hops before a break still count, with their streaks. */
export function comboDamageFromLinks(links: readonly LinkInfo[]): ComboDamage {
  const hops = chainLength(links);
  const streak = streakSteps(links).filter((s) => s > 0).length;
  return { hops, streak, total: hops + streak };
}

/** Total damage dealt (H + B). Uncapped; max 7 on a 5-card line. */
export function hopDamageFromLinks(links: readonly LinkInfo[]): number {
  return comboDamageFromLinks(links).total;
}
