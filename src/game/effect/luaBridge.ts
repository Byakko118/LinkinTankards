import type { EffectCardView, EffectSideView } from './types';

/** Shallow card for Lua — no nested .chain (avoids cycles through Wasmoon). */
function cardForLua(c: EffectCardView, withChain: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: c.id,
    type: c.type,
    name: c.name,
    slot: c.slot,
    side: c.side,
    zone: c.zone,
    lane: c.lane,
    lane_after: c.lane_after,
    outgoing_hop: c.outgoing_hop,
    outgoing_streak: c.outgoing_streak,
    outgoing_effect: c.outgoing_effect,
  };
  if (withChain) {
    out.chain = c.chain.map((x) => cardForLua(x, false));
  } else {
    out.chain = [];
  }
  return out;
}

function pileForLua(p: EffectSideView['draw']): Record<string, unknown> {
  return {
    count: p.count,
    cards: p.cards ? p.cards.map((c) => cardForLua(c, false)) : null,
    top: p.top ? cardForLua(p.top, false) : null,
  };
}

/** Snapshot a side view into plain JSON-safe tables for Lua injection. */
export function sideForLua(side: EffectSideView): Record<string, unknown> {
  const lineCards = side.line.cards.map((c) => cardForLua(c, true));
  return {
    hp: side.hp,
    deck_size: side.deck_size,
    slot: side.slot,
    chain: side.chain.map((c) => cardForLua(c, false)),
    line: {
      cards: lineCards,
      capacity: side.line.capacity,
      empty: side.line.empty,
      links: side.line.links.map((l) => ({ ...l })),
      break_at: side.line.break_at,
    },
    hand: {
      cards: side.hand.cards.map((c) => cardForLua(c, false)),
      unplayed: side.hand.unplayed.map((c) => cardForLua(c, false)),
      played: side.hand.played.map((c) => cardForLua(c, false)),
      count: side.hand.count,
      unplayed_count: side.hand.unplayed_count,
      played_count: side.hand.played_count,
    },
    draw: pileForLua(side.draw),
    discard: pileForLua(side.discard),
  };
}
