/** Host `fx` / ResolveView catalog for Monaco completions + hover (from effect-dsl.md). */

export interface FxSymbol {
  label: string;
  /** Insert text; may use snippet syntax ($1). */
  insertText: string;
  detail: string;
  documentation: string;
  kind: 'method' | 'property' | 'keyword' | 'snippet';
}

export const FX_ROOT: FxSymbol[] = [
  {
    label: 'fx.self',
    insertText: 'fx.self',
    detail: 'Side — acting seat',
    documentation:
      'Current side during the hook pulse. Has .hp .line .hand .draw .discard .deck_size .slot .chain. Passing fx.self to fx.add targets the pulsing card.',
    kind: 'property',
  },
  {
    label: 'fx.enemy',
    insertText: 'fx.enemy',
    detail: 'Side — opposing seat',
    documentation:
      'Enemy side. Faces in hand/draw/discard are hidden unless reveal; counts always OK. During SCORE do not read enemy outgoing — use CLASH.',
    kind: 'property',
  },
  {
    label: 'fx.outgoing',
    insertText: 'fx.outgoing(${1:card})',
    detail: 'outgoing(card, opts?) → number',
    documentation:
      'Sum of hop+streak+effect on a card. opts.skip / opts.only filter channels. Used in CLASH (e.g. Shield).',
    kind: 'method',
  },
  {
    label: 'fx.slot',
    insertText: 'fx.slot(${1:fx.self}, ${2:i})',
    detail: 'slot(side, i) → Card|nil',
    documentation: 'Line card at 1-based slot index, or nil if empty.',
    kind: 'method',
  },
  {
    label: 'fx.hand',
    insertText: 'fx.hand(${1:fx.self})',
    detail: 'hand(side) → Hand',
    documentation: 'Hand view: .cards .unplayed .played .count .unplayed_count .played_count.',
    kind: 'method',
  },
  {
    label: 'fx.unplayed',
    insertText: 'fx.unplayed(${1:fx.self})',
    detail: 'unplayed(side) → Card[]',
    documentation: 'Shorthand for hand.unplayed — cards still in hand at resolve (not on line).',
    kind: 'method',
  },
  {
    label: 'fx.draw_count',
    insertText: 'fx.draw_count(${1:fx.self})',
    detail: 'draw_count(side) → number',
    documentation: 'Remaining draw pile count (always visible).',
    kind: 'method',
  },
  {
    label: 'fx.discard_count',
    insertText: 'fx.discard_count(${1:fx.self})',
    detail: 'discard_count(side) → number',
    documentation: 'Discard pile count (always visible).',
    kind: 'method',
  },
  {
    label: 'fx.draw_cards',
    insertText: 'fx.draw_cards(${1:fx.self})',
    detail: 'draw_cards(side) → Card[]|nil',
    documentation: 'Own draw faces OK at resolve; enemy nil unless vision/reveal.',
    kind: 'method',
  },
  {
    label: 'fx.discard_cards',
    insertText: 'fx.discard_cards(${1:fx.self})',
    detail: 'discard_cards(side) → Card[]|nil',
    documentation: 'Own discard faces OK; enemy nil unless reveal.',
    kind: 'method',
  },
  {
    label: 'fx.add',
    insertText: 'fx.add(${1:fx.self}, ${2:100}, "effect")',
    detail: 'add(card, amount, channel)',
    documentation:
      'SCORE write: append to a card’s effect channel. v0 writers may only use channel "effect" (not mult).',
    kind: 'method',
  },
  {
    label: 'fx.deal',
    insertText: 'fx.deal(${1:fx.enemy.hp}, ${2:100}, "effect", fx.self)',
    detail: 'deal(target_hp, amount, channel, source)',
    documentation:
      'SCORE write: direct HP damage (bypasses slot clash / Shield). Pass fx.enemy.hp or fx.self.hp as target.',
    kind: 'method',
  },
  {
    label: 'fx.block_slot',
    insertText: 'fx.block_slot(${1:fx.self.slot}, ${2:amount})',
    detail: 'block_slot(slot, amount)',
    documentation:
      'CLASH write: reduce incoming from the mirrored enemy slot. Shield uses floor(outgoing(foe)/2).',
    kind: 'method',
  },
  {
    label: 'fx.channels',
    insertText: 'fx.channels',
    detail: '"hop"|"streak"|"effect"|"mult"',
    documentation: 'Damage channel names. Scripts write effect; hop/streak are host-attributed.',
    kind: 'property',
  },
  {
    label: 'fx.my_line',
    insertText: 'fx.my_line()',
    detail: 'my_line() → Line',
    documentation:
      'Sugar for fx.self.line — the acting side’s played line (.cards .capacity .empty .links .break_at).',
    kind: 'method',
  },
  {
    label: 'fx.my_slot',
    insertText: 'fx.my_slot()',
    detail: 'my_slot() → number|nil',
    documentation: 'Sugar for fx.self.slot — 1-based slot of the card currently pulsing this hook.',
    kind: 'method',
  },
  {
    label: 'fx.my_card',
    insertText: 'fx.my_card()',
    detail: 'my_card() → Card|nil',
    documentation: 'The pulsing card on my line (line.cards[my_slot]), or nil.',
    kind: 'method',
  },
  {
    label: 'fx.line_cards',
    insertText: 'fx.line_cards()',
    detail: 'line_cards() → Card[]',
    documentation: 'Sugar for fx.self.line.cards — played cards in order (1-based in Lua).',
    kind: 'method',
  },
  {
    label: 'fx.my_chain',
    insertText: 'fx.my_chain()',
    detail: 'my_chain() → Card[]',
    documentation:
      'Sugar for fx.self.chain — valid-prefix segment containing self (empty if past BREAK). Used by Golem.',
    kind: 'method',
  },
  {
    label: 'fx.empty_slots',
    insertText: 'fx.empty_slots()',
    detail: 'empty_slots() → number',
    documentation:
      'Sugar for fx.self.line.empty — unused line capacity (MAX_LINE − played). Burnt Offering.',
    kind: 'method',
  },
  {
    label: 'fx.enemy_at_my_slot',
    insertText: 'fx.enemy_at_my_slot()',
    detail: 'enemy_at_my_slot() → Card|nil',
    documentation:
      'Sugar for fx.enemy.line.cards[fx.self.slot] — mirrored enemy card, or nil. Used by Shield.',
    kind: 'method',
  },
  {
    label: 'fx.add_to_me',
    insertText: 'fx.add_to_me(${1:100})',
    detail: 'add_to_me(amount)',
    documentation: 'SCORE sugar: fx.add(fx.self, amount, "effect") — bump this card’s effect channel.',
    kind: 'method',
  },
  {
    label: 'fx.deal_to_enemy',
    insertText: 'fx.deal_to_enemy(${1:100})',
    detail: 'deal_to_enemy(amount)',
    documentation:
      'SCORE sugar: fx.deal(fx.enemy.hp, amount, "effect", fx.self) — direct HP, bypasses slot clash.',
    kind: 'method',
  },
  {
    label: 'fx.block_me',
    insertText: 'fx.block_me(${1:amount})',
    detail: 'block_me(amount)',
    documentation:
      'CLASH sugar: fx.block_slot(fx.self.slot, amount) — reduce incoming from the mirrored enemy slot.',
    kind: 'method',
  },
];

export const SIDE_FIELDS: FxSymbol[] = [
  {
    label: 'hp',
    insertText: 'hp',
    detail: 'number',
    documentation: 'Current HP (×100 scale).',
    kind: 'property',
  },
  {
    label: 'line',
    insertText: 'line',
    detail: 'Line',
    documentation: 'Played line this attack: .cards .capacity .empty .links .break_at',
    kind: 'property',
  },
  {
    label: 'hand',
    insertText: 'hand',
    detail: 'Hand',
    documentation: 'Draw-6 hand: .cards .unplayed .played + counts.',
    kind: 'property',
  },
  {
    label: 'draw',
    insertText: 'draw',
    detail: 'Pile',
    documentation: 'Draw pile: .count .cards (faces or nil) .top',
    kind: 'property',
  },
  {
    label: 'discard',
    insertText: 'discard',
    detail: 'Pile',
    documentation: 'Discard pile: .count .cards (faces or nil) .top',
    kind: 'property',
  },
  {
    label: 'deck_size',
    insertText: 'deck_size',
    detail: 'number',
    documentation: 'Total owned cards (usually 20).',
    kind: 'property',
  },
  {
    label: 'slot',
    insertText: 'slot',
    detail: 'number|nil',
    documentation: '1-based slot of the card currently pulsing this hook.',
    kind: 'property',
  },
  {
    label: 'chain',
    insertText: 'chain',
    detail: 'Card[]',
    documentation: 'Valid-prefix segment containing self (empty if past BREAK). Used by Golem.',
    kind: 'property',
  },
];

export const LINE_FIELDS: FxSymbol[] = [
  {
    label: 'cards',
    insertText: 'cards',
    detail: 'Card[]',
    documentation: 'Played cards in order (1-based in Lua).',
    kind: 'property',
  },
  {
    label: 'capacity',
    insertText: 'capacity',
    detail: '5',
    documentation: 'MAX_LINE — Burnt Offering uses capacity - #cards.',
    kind: 'property',
  },
  {
    label: 'empty',
    insertText: 'empty',
    detail: 'number',
    documentation: 'capacity - #cards (unused line slots).',
    kind: 'property',
  },
  {
    label: 'links',
    insertText: 'links',
    detail: 'Link[]',
    documentation: 'Adjacent links: .from .to .valid .index .hop_kind .streak_step',
    kind: 'property',
  },
  {
    label: 'break_at',
    insertText: 'break_at',
    detail: 'number|nil',
    documentation: '1-based index of first illegal link, or nil.',
    kind: 'property',
  },
];

export const CARD_FIELDS: FxSymbol[] = [
  {
    label: 'id',
    insertText: 'id',
    detail: 'string',
    documentation: 'Stable card id.',
    kind: 'property',
  },
  {
    label: 'type',
    insertText: 'type',
    detail: '"G"|"A"|"S"|"K"',
    documentation: 'Base hop type. G/A keepers; K/S changers.',
    kind: 'property',
  },
  {
    label: 'name',
    insertText: 'name',
    detail: 'string|nil',
    documentation: 'Special name when present (Thunderer, Shield, …).',
    kind: 'property',
  },
  {
    label: 'slot',
    insertText: 'slot',
    detail: 'number|nil',
    documentation: '1-based line slot, or nil if unplayed.',
    kind: 'property',
  },
  {
    label: 'side',
    insertText: 'side',
    detail: '"self"|"enemy"',
    documentation: 'Owning seat.',
    kind: 'property',
  },
  {
    label: 'zone',
    insertText: 'zone',
    detail: '"line"|"hand"|"draw"|"discard"',
    documentation: 'Current zone.',
    kind: 'property',
  },
  {
    label: 'lane',
    insertText: 'lane',
    detail: '0|1|nil',
    documentation: 'Play lane on line (0 ground / 1 air).',
    kind: 'property',
  },
  {
    label: 'outgoing_hop',
    insertText: 'outgoing_hop',
    detail: 'number',
    documentation: 'Hop channel attributed to this card (to-card of each link).',
    kind: 'property',
  },
  {
    label: 'outgoing_streak',
    insertText: 'outgoing_streak',
    detail: 'number',
    documentation: 'Streak channel on this card.',
    kind: 'property',
  },
  {
    label: 'outgoing_effect',
    insertText: 'outgoing_effect',
    detail: 'number',
    documentation: 'Script effect channel on this card.',
    kind: 'property',
  },
  {
    label: 'chain',
    insertText: 'chain',
    detail: 'Card[]',
    documentation: 'Valid-prefix segment containing this card.',
    kind: 'property',
  },
];

export const HOOK_SNIPPETS: FxSymbol[] = [
  {
    label: 'on_score',
    insertText:
      'function on_score(fx)\n  ${1:-- SCORE: fx.line_cards() / fx.add_to_me / fx.deal_to_enemy}\nend',
    detail: 'SCORE hook',
    documentation:
      'Runs per card in ascending slot after hops/streak attributed. Thunderer, Golem, Sprinter, Burnt Offering.',
    kind: 'snippet',
  },
  {
    label: 'on_clash',
    insertText:
      'function on_clash(fx)\n  ${1:-- CLASH: fx.enemy_at_my_slot(); fx.block_me}\nend',
    detail: 'CLASH hook',
    documentation:
      'Runs after both sides finished SCORE. Shield blocks half of mirrored enemy slot outgoing.',
    kind: 'snippet',
  },
];

export const ALL_FX_SYMBOLS: FxSymbol[] = [
  ...FX_ROOT,
  ...SIDE_FIELDS,
  ...LINE_FIELDS,
  ...CARD_FIELDS,
  ...HOOK_SNIPPETS,
];
