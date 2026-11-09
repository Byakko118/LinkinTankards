import type { ScriptedCardDef } from './types';

const BLANK_SCRIPT = `-- hooks: score
-- fx = effects toolkit the game injects into this script (host API).
-- Prefer the sugar helpers when you can — they avoid dense fx.self.* paths:
--   fx.my_slot() / fx.my_line() / fx.line_cards() / fx.my_chain()
--   fx.add_to_me(n)       = fx.add(fx.self, n, "effect")
--   fx.deal_to_enemy(n)   = fx.deal(fx.enemy.hp, n, "effect", fx.self)
--   fx.block_me(n)        = fx.block_slot(fx.self.slot, n)
-- Full power (fx.self / fx.enemy / fx.add / …) is still available.

function on_score(fx)
  -- SCORE: hop/streak already attributed; write with fx.add_to_me / fx.deal_to_enemy
  local _ = fx.my_slot()
end

-- function on_clash(fx)
--   -- CLASH: both sides scored; block incoming with fx.block_me
--   -- local foe = fx.enemy_at_my_slot()
--   -- fx.block_me(math.floor(fx.outgoing(foe) / 2))
-- end
`;

const THUNDERER_SCRIPT = `-- hooks: score
-- Why not fully sugar? Neighbor windows (S-K-S in any of three seats) need
-- real Lua indexing — a helper would just be a Thunderer-only special case.
function on_score(fx)
  -- Instead of: local line, i = fx.self.line, fx.self.slot
  local i = fx.my_slot()
  local L = fx.line_cards()
  local function is_sks(a, b, c)
    return a and b and c and a.type == "S" and b.type == "K" and c.type == "S"
  end
  if is_sks(L[i - 1], L[i], L[i + 1])
     or is_sks(L[i], L[i + 1], L[i + 2])
     or is_sks(L[i - 2], L[i - 1], L[i]) then
    fx.add_to_me(100)  -- same as fx.add(fx.self, 100, "effect")
  end
end
`;

const SHIELD_SCRIPT = `-- hooks: clash
-- Mirrored-slot block: sugar hides fx.enemy.line.cards[fx.self.slot].
function on_clash(fx)
  local foe = fx.enemy_at_my_slot()
  if not foe then return end
  local half = math.floor(fx.outgoing(foe) / 2)
  fx.block_me(half)  -- same as fx.block_slot(fx.self.slot, half)
end
`;

const GOLEM_SCRIPT = `-- hooks: score
-- Chain = unbroken valid-prefix segment containing this card.
function on_score(fx)
  local n = 0
  for _, c in ipairs(fx.my_chain()) do  -- same as fx.self.chain
    if c.type == "G" then n = n + 1 end
  end
  fx.add_to_me(n * 50)
end
`;

const SPRINTER_SCRIPT = `-- hooks: score
-- Counts the full played line (including past BREAK), not hand leftovers.
function on_score(fx)
  local n = 0
  for _, c in ipairs(fx.line_cards()) do  -- same as fx.self.line.cards
    if c.type == "K" or c.type == "S" then n = n + 1 end
  end
  fx.add_to_me(n * 30)
end
`;

const BURNT_OFFERING_SCRIPT = `-- hooks: score
-- empty_slots = unused line capacity (MAX_LINE − played), not leftover hand.
function on_score(fx)
  local empty = fx.empty_slots()  -- same as fx.self.line.empty
  if empty > 0 then
    fx.deal_to_enemy(empty * 100)  -- direct HP; bypasses slot clash / Shield
  end
end
`;

export const STARTER_CARDS: readonly ScriptedCardDef[] = [
  {
    id: 'blank',
    type: 'G',
    name: 'Default (blank)',
    damage: 0,
    hooks: ['score'],
    script: BLANK_SCRIPT,
  },
  {
    id: 'thunderer',
    type: 'K',
    name: 'Thunderer',
    damage: 5,
    hooks: ['score'],
    script: THUNDERER_SCRIPT,
  },
  {
    id: 'shield',
    type: 'G',
    name: 'Shield',
    damage: 3,
    hooks: ['clash'],
    script: SHIELD_SCRIPT,
  },
  {
    id: 'golem',
    type: 'G',
    name: 'Golem',
    damage: 3,
    hooks: ['score'],
    script: GOLEM_SCRIPT,
  },
  {
    id: 'sprinter',
    type: 'A',
    name: 'Sprinter',
    damage: 4,
    hooks: ['score'],
    script: SPRINTER_SCRIPT,
  },
  {
    id: 'burnt-offering',
    type: 'S',
    name: 'Burnt Offering',
    damage: 3,
    hooks: ['score'],
    script: BURNT_OFFERING_SCRIPT,
  },
];

export function starterById(id: string): ScriptedCardDef | undefined {
  return STARTER_CARDS.find((c) => c.id === id);
}
