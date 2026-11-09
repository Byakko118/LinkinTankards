import { CardType, LinkInfo, chainLength } from './rules';

/** Longest line a player may build (max 4 hops). */
export const MAX_LINE = 5;

/**
 * Combat number scale (locked 2026-11-09). Pure ×100 of the 1-HP rules so ratios stay
 * identical; a future Mult channel can multiply these unit values cleanly.
 */
export const DAMAGE_UNIT = 100;
export const HOP_DAMAGE = DAMAGE_UNIT;
export const STREAK_BONUS = DAMAGE_UNIT;
export const BREAK_RECOIL = DAMAGE_UNIT;
export const STARTING_HP = 28 * DAMAGE_UNIT;
/** Max H+B on a 5-card line (4 hops + 3 streak). */
export const MAX_COMBO_DAMAGE = 7 * DAMAGE_UNIT;
/** HP at-or-below this reads as "low" in the fighter chrome (was 5 at unit scale). */
export const LOW_HP = 5 * DAMAGE_UNIT;

export interface ComboDamage {
  /** Damage from legal hops before the first break (HOP_DAMAGE each). */
  hops: number;
  /** Streak bonus damage (STREAK_BONUS per repeating hop kind). */
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
  const hopCount = chainLength(links);
  const streakCount = streakSteps(links).filter((s) => s > 0).length;
  const hops = hopCount * HOP_DAMAGE;
  const streak = streakCount * STREAK_BONUS;
  return { hops, streak, total: hops + streak };
}

/** Total damage dealt (H + B). Uncapped; max MAX_COMBO_DAMAGE on a 5-card line. */
export function hopDamageFromLinks(links: readonly LinkInfo[]): number {
  return comboDamageFromLinks(links).total;
}

/** Ink / tally label for one streak step (e.g. "+100"). */
export function streakSealText(): string {
  return `+${STREAK_BONUS}`;
}
