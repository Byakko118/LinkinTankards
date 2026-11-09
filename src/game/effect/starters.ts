import type { ScriptedCardDef } from './types';

const THUNDERER_SCRIPT = `-- hooks: score
function on_score(fx)
  local line, i = fx.self.line, fx.self.slot
  local function is_sks(a, b, c)
    return a and b and c and a.type == "S" and b.type == "K" and c.type == "S"
  end
  local L = line.cards
  if is_sks(L[i - 1], L[i], L[i + 1])
     or is_sks(L[i], L[i + 1], L[i + 2])
     or is_sks(L[i - 2], L[i - 1], L[i]) then
    fx.add(fx.self, 100, "effect")
  end
end
`;

const SHIELD_SCRIPT = `-- hooks: clash
function on_clash(fx)
  local foe = fx.enemy.line.cards[fx.self.slot]
  if not foe then return end
  local half = math.floor(fx.outgoing(foe) / 2)
  fx.block_slot(fx.self.slot, half)  -- reduces what that enemy slot deals to us
end
`;

const GOLEM_SCRIPT = `-- hooks: score
function on_score(fx)
  local n = 0
  for _, c in ipairs(fx.self.chain) do  -- unbroken prefix segment containing self
    if c.type == "G" then n = n + 1 end
  end
  fx.add(fx.self, n * 50, "effect")
end
`;

const SPRINTER_SCRIPT = `-- hooks: score
function on_score(fx)
  local n = 0
  for _, c in ipairs(fx.self.line.cards) do
    if c.type == "K" or c.type == "S" then n = n + 1 end
  end
  fx.add(fx.self, n * 30, "effect")
end
`;

const BURNT_OFFERING_SCRIPT = `-- hooks: score
function on_score(fx)
  local empty = fx.self.line.capacity - #fx.self.line.cards  -- MAX_LINE (5) − played
  if empty > 0 then
    fx.deal(fx.enemy.hp, empty * 100, "effect", fx.self)
  end
end
`;

export const STARTER_CARDS: readonly ScriptedCardDef[] = [
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
