import type { BuiltResolveView, BuiltSide } from './resolveView';
import type { DamageChannel, SideId } from './types';

export interface FxHostState {
  view: BuiltResolveView;
  phase: 'score' | 'clash' | 'apply';
  /** Side whose script is currently running. */
  actor: SideId;
  log: string[];
  /** Incoming blocks keyed by defending side → slot (1-based) → amount. */
  blocks: { self: number[]; enemy: number[] };
  deals: { toSelf: number; toEnemy: number };
  errors: string[];
}

type LuaCardLike = {
  id?: string;
  slot?: number | null;
  side?: SideId;
  line?: unknown;
  chain?: unknown;
  type?: string;
};

function isSideLike(v: unknown): v is { slot?: number | null; line?: unknown; hp?: number } {
  return !!v && typeof v === 'object' && 'line' in (v as object) && 'hp' in (v as object);
}

function resolveBuiltCard(state: FxHostState, card: unknown) {
  if (card == null) return null;
  if (isSideLike(card)) {
    const side = state.actor === 'self' ? state.view.self : state.view.enemy;
    const slot = side.view.slot;
    if (slot == null) return null;
    return side.lineCards[slot - 1] ?? null;
  }
  const like = card as LuaCardLike;
  if (like.id) {
    return (
      state.view.self.byId.get(like.id) ??
      state.view.enemy.byId.get(like.id) ??
      null
    );
  }
  if (like.side && like.slot) {
    const side = like.side === 'self' ? state.view.self : state.view.enemy;
    return side.lineCards[like.slot - 1] ?? null;
  }
  return null;
}

function sideOf(state: FxHostState, side: SideId | BuiltSide | unknown): BuiltSide {
  if (side === 'self' || side === state.view.self.view || side === state.view.self) {
    return state.view.self;
  }
  if (side === 'enemy' || side === state.view.enemy.view || side === state.view.enemy) {
    return state.view.enemy;
  }
  if (isSideLike(side)) {
    // Compare by identity of nested line array ref when possible
    if ((side as { line?: { cards?: unknown } }).line === state.view.self.view.line) {
      return state.view.self;
    }
    if ((side as { line?: { cards?: unknown } }).line === state.view.enemy.view.line) {
      return state.view.enemy;
    }
  }
  // Default: actor for hand helpers when Lua passes fx.self / fx.enemy tables (copies)
  const maybe = side as { hp?: number; deck_size?: number };
  if (maybe && maybe.hp === state.view.self.view.hp && maybe.deck_size === state.view.self.view.deck_size) {
    return state.view.self;
  }
  if (maybe && maybe.hp === state.view.enemy.view.hp && maybe.deck_size === state.view.enemy.view.deck_size) {
    return state.view.enemy;
  }
  return state.actor === 'self' ? state.view.self : state.view.enemy;
}

function ensureBlockArray(arr: number[], slot: number): void {
  while (arr.length < slot) arr.push(0);
}

export function createFxApi(state: FxHostState) {
  const channels = ['hop', 'streak', 'effect', 'mult'] as const;

  function outgoing(card: unknown, opts?: { skip?: string; only?: string }): number {
    const built = resolveBuiltCard(state, card);
    if (!built) return 0;
    const skip = opts?.skip;
    const only = opts?.only;
    const parts: Record<DamageChannel, number> = {
      hop: built.mutable.hop,
      streak: built.mutable.streak,
      effect: built.mutable.effect,
      mult: 0,
    };
    if (only) {
      return parts[only as DamageChannel] ?? 0;
    }
    let sum = 0;
    for (const ch of channels) {
      if (skip && ch === skip) continue;
      sum += parts[ch];
    }
    return sum;
  }

  return {
    channels,
    get self() {
      return state.view.self.view;
    },
    get enemy() {
      return state.view.enemy.view;
    },
    outgoing,
    slot(sideArg: unknown, i: number) {
      const side = sideOf(state, sideArg);
      return side.lineCards[i - 1]?.view ?? null;
    },
    hand(sideArg: unknown) {
      return sideOf(state, sideArg).view.hand;
    },
    unplayed(sideArg: unknown) {
      return sideOf(state, sideArg).view.hand.unplayed;
    },
    draw_count(sideArg: unknown) {
      return sideOf(state, sideArg).view.draw.count;
    },
    discard_count(sideArg: unknown) {
      return sideOf(state, sideArg).view.discard.count;
    },
    draw_cards(sideArg: unknown) {
      const side = sideOf(state, sideArg);
      return side.hideFaces ? null : side.view.draw.cards;
    },
    discard_cards(sideArg: unknown) {
      const side = sideOf(state, sideArg);
      return side.hideFaces ? null : side.view.discard.cards;
    },
    add(card: unknown, amount: number, channel: string) {
      if (state.phase !== 'score') {
        state.log.push(`fx.add blocked outside SCORE (${state.phase})`);
        return;
      }
      if (channel !== 'effect') {
        state.log.push(`fx.add rejected channel "${channel}" (v0 writers: effect only)`);
        return;
      }
      const n = Math.floor(Number(amount) || 0);
      const built = resolveBuiltCard(state, card);
      if (!built) {
        state.log.push('fx.add: could not resolve card');
        return;
      }
      built.mutable.effect += n;
      built.view.outgoing_effect = built.mutable.effect;
      state.log.push(
        `add +${n} effect → ${built.view.name ?? built.view.type} slot ${built.view.slot}`,
      );
    },
    deal(targetHp: number, amount: number, channel: string, _source?: unknown) {
      if (state.phase !== 'score') {
        state.log.push(`fx.deal blocked outside SCORE (${state.phase})`);
        return;
      }
      if (channel !== 'effect') {
        state.log.push(`fx.deal rejected channel "${channel}"`);
        return;
      }
      const n = Math.floor(Number(amount) || 0);
      // target is the HP number of a side — match against current views
      if (targetHp === state.view.enemy.view.hp || targetHp === state.view.enemy.hp) {
        state.deals.toEnemy += n;
        state.log.push(`deal ${n} direct → enemy HP`);
      } else if (targetHp === state.view.self.view.hp || targetHp === state.view.self.hp) {
        state.deals.toSelf += n;
        state.log.push(`deal ${n} direct → self HP`);
      } else {
        // Fallback: attacking side deals to enemy
        state.deals.toEnemy += n;
        state.log.push(`deal ${n} direct → enemy HP (fallback)`);
      }
    },
    block_slot(slot: number, amount: number) {
      if (state.phase !== 'clash') {
        state.log.push(`fx.block_slot blocked outside CLASH (${state.phase})`);
        return;
      }
      const n = Math.floor(Number(amount) || 0);
      const s = Math.floor(Number(slot) || 0);
      if (s < 1) return;
      const blocks = state.blocks[state.actor];
      ensureBlockArray(blocks, s);
      blocks[s - 1] = (blocks[s - 1] ?? 0) + n;
      state.log.push(`block_slot ${s} += ${n} (${state.actor})`);
    },
  };
}

export type FxApi = ReturnType<typeof createFxApi>;
