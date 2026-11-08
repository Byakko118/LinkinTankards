import { CardDef, CardType, makeCard } from './rules';
import { SeededRng, shuffleWithRng } from './rng';

const TAVERN_TYPES: CardType[] = ['G', 'A', 'S', 'K'];
const PER_TYPE = 5;

export const HAND_SIZE = 6;

export function buildTavernDeck(): CardDef[] {
  const deck: CardDef[] = [];
  for (const type of TAVERN_TYPES) {
    for (let i = 0; i < PER_TYPE; i++) {
      deck.push(makeCard(type));
    }
  }
  return deck;
}

export class TavernPile {
  private draw: CardDef[] = [];
  private discard: CardDef[] = [];
  private readonly rng: SeededRng;

  constructor(rng: SeededRng) {
    this.rng = rng;
    this.draw = shuffleWithRng(buildTavernDeck(), rng);
  }

  get drawCount(): number {
    return this.draw.length;
  }

  get discardCount(): number {
    return this.discard.length;
  }

  /** Draws from the pile; when it runs dry, the rest is taken first and the discard is reshuffled into a new pile. */
  drawHand(count = HAND_SIZE): CardDef[] {
    const hand: CardDef[] = [];
    while (hand.length < count) {
      if (this.draw.length === 0) {
        if (this.discard.length === 0) {
          this.draw = shuffleWithRng(buildTavernDeck(), this.rng);
        } else {
          this.draw = shuffleWithRng(this.discard, this.rng);
          this.discard = [];
        }
      }
      hand.push(...this.draw.splice(0, count - hand.length));
    }
    return hand;
  }

  discardCards(cards: readonly CardDef[]): void {
    this.discard.push(...cards);
  }
}
