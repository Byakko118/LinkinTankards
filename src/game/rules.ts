export type CardType = 'G' | 'A' | 'S' | 'K';
/** 0 = ground (bottom), 1 = air (top). */
export type Lane = 0 | 1;

export interface CardDef {
  id: string;
  type: CardType;
  damage: number;
}

/**
 * Directed next-card adjacency by lane-after-type (project-context source of truth).
 *
 * After G (ground) → G, K
 * After K (air)    → A, S
 * After A (air)    → A, S
 * After S (ground) → G, K
 */
const NEXT_ALLOWED: Record<CardType, ReadonlySet<CardType>> = {
  G: new Set(['G', 'K']),
  K: new Set(['A', 'S']),
  A: new Set(['A', 'S']),
  S: new Set(['G', 'K']),
};

export const TYPE_NAMES: Record<CardType, string> = {
  G: 'Ground',
  A: 'Air',
  S: 'Slam',
  K: 'Knockup',
};

/** Lane you occupy after resolving this card. */
export function laneAfter(type: CardType): Lane {
  // G stay ground, S air→ground → ground; A stay air, K ground→air → air
  return type === 'G' || type === 'S' ? 0 : 1;
}

/** Visual row the card sits on while played. */
export function playLaneOf(type: CardType): Lane {
  // G/K occupy ground; A/S occupy air. Transitions show on the link between.
  return type === 'G' || type === 'K' ? 0 : 1;
}

export function canConnect(from: CardType, to: CardType): boolean {
  return NEXT_ALLOWED[from].has(to);
}

/** K = ground→air, S = air→ground. */
export function isLaneChanger(type: CardType): boolean {
  return type === 'K' || type === 'S';
}

/** G = stay ground, A = stay air. */
export function isLaneKeeper(type: CardType): boolean {
  return type === 'G' || type === 'A';
}

/**
 * Lane path for a play line: each card sits on its natural row (G/K ground, A/S air).
 * Start implied ground — first card may be anything for the rough loop; illegal
 * adjacency is still caught by canConnect on subsequent pairs.
 */
export function computeLanes(cards: readonly CardDef[]): Lane[] {
  return cards.map((c) => playLaneOf(c.type));
}

export interface LinkInfo {
  index: number; // link between card[i] and card[i+1]
  from: CardType;
  to: CardType;
  valid: boolean;
}

export function evaluateLinks(cards: readonly CardDef[]): LinkInfo[] {
  const links: LinkInfo[] = [];
  for (let i = 0; i < cards.length - 1; i++) {
    const from = cards[i].type;
    const to = cards[i + 1].type;
    links.push({ index: i, from, to, valid: canConnect(from, to) });
  }
  return links;
}

/** Longest prefix of consecutive valid adjacent links (chain breaks at first invalid). */
export function chainLength(links: readonly LinkInfo[]): number {
  let n = 0;
  for (const link of links) {
    if (!link.valid) break;
    n += 1;
  }
  return n;
}

/** Index of first invalid link, or -1 if none. */
export function firstBreakIndex(links: readonly LinkInfo[]): number {
  return links.findIndex((l) => !l.valid);
}

/** Damage from cards in the unbroken chain prefix only. */
export function resolveChainDamage(cards: readonly CardDef[], links: readonly LinkInfo[]): number {
  if (cards.length === 0) return 0;
  const unbroken = chainLength(links);
  const cardsInChain = unbroken + 1;
  return cards.slice(0, Math.min(cardsInChain, cards.length)).reduce((sum, c) => sum + c.damage, 0);
}

const TYPE_DAMAGE: Record<CardType, number> = {
  G: 3,
  A: 4,
  S: 3,
  K: 5,
};

const DECK_COUNTS: Record<CardType, number> = {
  G: 8,
  A: 6,
  S: 8,
  K: 6,
};

let idSeq = 0;

export function makeCard(type: CardType): CardDef {
  idSeq += 1;
  return { id: `${type}-${idSeq}`, type, damage: TYPE_DAMAGE[type] };
}

export function buildDeck(): CardDef[] {
  const deck: CardDef[] = [];
  (Object.keys(DECK_COUNTS) as CardType[]).forEach((type) => {
    for (let i = 0; i < DECK_COUNTS[type]; i++) {
      deck.push(makeCard(type));
    }
  });
  return shuffle(deck);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawHand(deck: CardDef[], count = 5): { hand: CardDef[]; rest: CardDef[] } {
  if (deck.length < count) {
    const fresh = buildDeck();
    return { hand: fresh.slice(0, count), rest: fresh.slice(count) };
  }
  return { hand: deck.slice(0, count), rest: deck.slice(count) };
}

export const TYPE_COLORS: Record<CardType, number> = {
  G: 0xc45c26, // Ground — warm earth
  A: 0x3d7ea6, // Air — sky blue
  S: 0x3d8b5f, // Slam — impact green
  K: 0x8b5aad, // Knockup — violet
};
