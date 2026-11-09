import type { CardType, Lane } from '../rules';

/** Resolve-time hooks. Starters use score + clash only. */
export type EffectHook =
  | 'commit'
  | 'edge'
  | 'score'
  | 'clash'
  | 'damage'
  | 'verdict_ink'
  | 'turn_end';

export type DamageChannel = 'hop' | 'streak' | 'effect' | 'mult';

export type CardZone = 'line' | 'hand' | 'draw' | 'discard';
export type SideId = 'self' | 'enemy';

/** Card definition with Lua script + declared hooks. */
export interface ScriptedCardDef {
  id: string;
  type: CardType;
  name: string;
  /** Legacy display damage; hop/streak/effect own real combat numbers. */
  damage: number;
  script: string;
  hooks: EffectHook[];
}

export type HopKindLabel = 'press' | 'launch' | 'follow' | 'juggle' | 'other';

export interface EffectCardView {
  id: string;
  type: CardType;
  name: string | null;
  /** 1-based line slot, or null if not on line. */
  slot: number | null;
  side: SideId;
  zone: CardZone;
  lane: Lane | null;
  lane_after: Lane;
  outgoing_hop: number;
  outgoing_streak: number;
  outgoing_effect: number;
  /** Valid-prefix segment containing this card; empty if past break / not on line. */
  chain: EffectCardView[];
}

export interface EffectLinkView {
  from: CardType;
  to: CardType;
  valid: boolean;
  index: number;
  hop_kind: HopKindLabel;
  streak_step: number;
}

export interface EffectLineView {
  cards: EffectCardView[];
  capacity: number;
  empty: number;
  links: EffectLinkView[];
  break_at: number | null;
}

export interface EffectHandView {
  cards: EffectCardView[];
  unplayed: EffectCardView[];
  played: EffectCardView[];
  count: number;
  unplayed_count: number;
  played_count: number;
}

export interface EffectPileView {
  count: number;
  /** Own faces always; enemy nil unless reveal. */
  cards: EffectCardView[] | null;
  top: EffectCardView | null;
}

export interface EffectSideView {
  hp: number;
  line: EffectLineView;
  hand: EffectHandView;
  draw: EffectPileView;
  discard: EffectPileView;
  deck_size: number;
  /** Pulse context: 1-based slot of the card currently running a hook. */
  slot: number | null;
  /** Pulse context: chain of the current card. */
  chain: EffectCardView[];
}

export interface MockSideInput {
  hp: number;
  /** Played line types / scripted defs (order = slots 1..n). */
  line: Array<CardType | ScriptedCardDef>;
  /** Unplayed hand faces (own). Enemy may pass counts-only via hideFaces. */
  unplayed?: Array<CardType | ScriptedCardDef>;
  draw?: Array<CardType | ScriptedCardDef>;
  discard?: Array<CardType | ScriptedCardDef>;
  deck_size?: number;
  /** Hide pile/hand faces (enemy default). Counts still visible. */
  hideFaces?: boolean;
  lineCapacity?: number;
}

export interface MockResolveInput {
  self: MockSideInput;
  enemy: MockSideInput;
}

export interface CardChannelSnapshot {
  id: string;
  name: string | null;
  type: CardType;
  slot: number;
  side: SideId;
  hop: number;
  streak: number;
  effect: number;
  outgoing: number;
}

export interface ResolveRunResult {
  log: string[];
  selfCards: CardChannelSnapshot[];
  enemyCards: CardChannelSnapshot[];
  selfBlocks: number[];
  enemyBlocks: number[];
  /** Direct deals to enemy / self HP (effect channel). */
  dealsToEnemy: number;
  dealsToSelf: number;
  /** Per-slot clash hits into self (after blocks). */
  hitsOnSelf: number[];
  hitsOnEnemy: number[];
  selfHpAfter: number;
  enemyHpAfter: number;
  errors: string[];
}
