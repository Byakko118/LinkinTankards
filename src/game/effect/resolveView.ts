import { HOP_DAMAGE, MAX_LINE, STREAK_BONUS, streakSteps } from '../hopDamage';
import {
  CardType,
  LinkInfo,
  evaluateLinks,
  firstBreakIndex,
  laneAfter,
  playLaneOf,
} from '../rules';
import type {
  EffectCardView,
  EffectHandView,
  EffectLineView,
  EffectLinkView,
  EffectPileView,
  EffectSideView,
  HopKindLabel,
  MockResolveInput,
  MockSideInput,
  ScriptedCardDef,
  SideId,
} from './types';

export interface BuiltCard {
  view: EffectCardView;
  def: ScriptedCardDef | null;
  mutable: { hop: number; streak: number; effect: number };
}

export interface BuiltSide {
  id: SideId;
  hp: number;
  view: EffectSideView;
  lineCards: BuiltCard[];
  /** All cards by id (line + unplayed + piles). */
  byId: Map<string, BuiltCard>;
  hideFaces: boolean;
}

export interface BuiltResolveView {
  self: BuiltSide;
  enemy: BuiltSide;
}

let seq = 0;

function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function asDef(entry: CardType | ScriptedCardDef, fallbackName?: string): ScriptedCardDef {
  if (typeof entry === 'string') {
    return {
      id: nextId(entry),
      type: entry,
      name: fallbackName ?? entry,
      damage: 0,
      script: '',
      hooks: [],
    };
  }
  return {
    ...entry,
    id: entry.id || nextId(entry.type),
  };
}

function hopKindLabel(from: CardType, to: CardType): HopKindLabel {
  if ((from === 'G' && to === 'G') || (from === 'A' && to === 'A')) return 'press';
  if ((from === 'S' && to === 'K') || (from === 'K' && to === 'S')) return 'juggle';
  if ((from === 'G' && to === 'K') || (from === 'S' && to === 'G')) return 'launch';
  if ((from === 'K' && to === 'A') || (from === 'A' && to === 'S')) return 'follow';
  return 'other';
}

function buildLinks(types: CardType[]): { links: EffectLinkView[]; breakAt: number | null; raw: LinkInfo[] } {
  const raw = evaluateLinks(types.map((type) => ({ id: type, type, damage: 0 })));
  const steps = streakSteps(raw);
  const breakIdx = firstBreakIndex(raw);
  const links: EffectLinkView[] = raw.map((l, i) => ({
    from: l.from,
    to: l.to,
    valid: l.valid,
    index: i + 1, // 1-based for Lua authors
    hop_kind: hopKindLabel(l.from, l.to),
    streak_step: steps[i] ?? 0,
  }));
  return {
    links,
    breakAt: breakIdx >= 0 ? breakIdx + 1 : null,
    raw,
  };
}

/** Cards in the unbroken prefix segment that contains `slot` (1-based). */
function chainForSlot(lineViews: EffectCardView[], raw: LinkInfo[], slot: number): EffectCardView[] {
  if (slot < 1 || slot > lineViews.length) return [];
  const breakIdx = firstBreakIndex(raw); // 0-based link index
  const prefixLen = breakIdx < 0 ? lineViews.length : breakIdx + 1;
  // slots 1..prefixLen are in the valid prefix; past break → empty
  if (slot > prefixLen) return [];
  return lineViews.slice(0, prefixLen);
}

function makePile(
  entries: Array<CardType | ScriptedCardDef> | undefined,
  side: SideId,
  zone: 'draw' | 'discard',
  hideFaces: boolean,
  byId: Map<string, BuiltCard>,
): EffectPileView {
  const list = (entries ?? []).map((e) => {
    const def = asDef(e);
    const built: BuiltCard = {
      def: def.script ? def : null,
      mutable: { hop: 0, streak: 0, effect: 0 },
      view: {
        id: def.id,
        type: def.type,
        name: def.name,
        slot: null,
        side,
        zone,
        lane: null,
        lane_after: laneAfter(def.type),
        outgoing_hop: 0,
        outgoing_streak: 0,
        outgoing_effect: 0,
        chain: [],
      },
    };
    byId.set(def.id, built);
    return built.view;
  });
  return {
    count: list.length,
    cards: hideFaces ? null : list,
    top: hideFaces || list.length === 0 ? null : list[0],
  };
}

function buildSide(side: SideId, input: MockSideInput): BuiltSide {
  const hideFaces = input.hideFaces ?? side === 'enemy';
  const byId = new Map<string, BuiltCard>();
  const capacity = input.lineCapacity ?? MAX_LINE;

  const lineBuilt: BuiltCard[] = input.line.map((entry, i) => {
    const def = asDef(entry, typeof entry === 'object' ? entry.name : undefined);
    const built: BuiltCard = {
      def: typeof entry === 'object' ? entry : null,
      mutable: { hop: 0, streak: 0, effect: 0 },
      view: {
        id: def.id,
        type: def.type,
        name: typeof entry === 'object' ? entry.name : null,
        slot: i + 1,
        side,
        zone: 'line',
        lane: playLaneOf(def.type),
        lane_after: laneAfter(def.type),
        outgoing_hop: 0,
        outgoing_streak: 0,
        outgoing_effect: 0,
        chain: [],
      },
    };
    byId.set(def.id, built);
    return built;
  });

  const types = lineBuilt.map((c) => c.view.type);
  const { links, breakAt, raw } = buildLinks(types);
  const lineViews = lineBuilt.map((c) => c.view);

  for (const c of lineBuilt) {
    const slot = c.view.slot!;
    c.view.chain = chainForSlot(lineViews, raw, slot);
  }

  // Attribute hop/streak onto arriving (to) card — v0 host rule from effect-dsl.md
  for (let i = 0; i < raw.length; i++) {
    const link = raw[i];
    if (!link.valid) break;
    const toCard = lineBuilt[i + 1];
    if (!toCard) break;
    toCard.mutable.hop += HOP_DAMAGE;
    const step = streakSteps(raw)[i] ?? 0;
    if (step > 0) toCard.mutable.streak += STREAK_BONUS;
    toCard.view.outgoing_hop = toCard.mutable.hop;
    toCard.view.outgoing_streak = toCard.mutable.streak;
  }

  const unplayedBuilt = (input.unplayed ?? []).map((entry) => {
    const def = asDef(entry, typeof entry === 'object' ? entry.name : undefined);
    const built: BuiltCard = {
      def: typeof entry === 'object' ? entry : null,
      mutable: { hop: 0, streak: 0, effect: 0 },
      view: {
        id: def.id,
        type: def.type,
        name: typeof entry === 'object' ? entry.name : null,
        slot: null,
        side,
        zone: 'hand',
        lane: null,
        lane_after: laneAfter(def.type),
        outgoing_hop: 0,
        outgoing_streak: 0,
        outgoing_effect: 0,
        chain: [],
      },
    };
    byId.set(def.id, built);
    return built;
  });

  const playedViews = lineViews;
  const unplayedViews = unplayedBuilt.map((c) => c.view);
  const handCards = [...unplayedViews, ...playedViews];
  const hand: EffectHandView = {
    cards: hideFaces ? [] : handCards,
    unplayed: hideFaces ? [] : unplayedViews,
    played: hideFaces ? [] : playedViews,
    count: handCards.length,
    unplayed_count: unplayedViews.length,
    played_count: playedViews.length,
  };

  // Enemy: counts OK, faces hidden — still expose count fields; empty face arrays
  if (hideFaces) {
    hand.cards = [];
    hand.unplayed = [];
    hand.played = [];
  }

  const draw = makePile(input.draw, side, 'draw', hideFaces, byId);
  const discard = makePile(input.discard, side, 'discard', hideFaces, byId);

  const line: EffectLineView = {
    cards: lineViews,
    capacity,
    empty: Math.max(0, capacity - lineViews.length),
    links,
    break_at: breakAt,
  };

  const deck_size =
    input.deck_size ??
    lineViews.length + unplayedViews.length + draw.count + discard.count;

  const view: EffectSideView = {
    hp: input.hp,
    line,
    hand,
    draw,
    discard,
    deck_size,
    slot: null,
    chain: [],
  };

  return { id: side, hp: input.hp, view, lineCards: lineBuilt, byId, hideFaces };
}

export function buildResolveView(input: MockResolveInput): BuiltResolveView {
  seq = 0;
  return {
    self: buildSide('self', input.self),
    enemy: buildSide('enemy', {
      ...input.enemy,
      hideFaces: input.enemy.hideFaces ?? true,
    }),
  };
}

/** Sync mutable channels onto card views before CLASH freeze. */
export function syncOutgoing(side: BuiltSide): void {
  for (const c of side.lineCards) {
    c.view.outgoing_hop = c.mutable.hop;
    c.view.outgoing_streak = c.mutable.streak;
    c.view.outgoing_effect = c.mutable.effect;
  }
}

export function setPulse(side: BuiltSide, slot: number | null): void {
  side.view.slot = slot;
  if (slot == null) {
    side.view.chain = [];
    return;
  }
  const card = side.lineCards[slot - 1];
  side.view.chain = card ? card.view.chain : [];
}
