import { CardDef, CardType, makeCard } from './rules';
import { SeededRng, shuffleWithRng } from './rng';

const TAVERN_TYPES: CardType[] = ['G', 'A', 'S', 'K'];
const PER_TYPE = 5;

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

  drawHand(count = 5): CardDef[] {
    while (this.draw.length < count) {
      if (this.discard.length === 0) {
        this.draw = shuffleWithRng(buildTavernDeck(), this.rng);
        this.discard = [];
        break;
      }
      this.draw = shuffleWithRng(this.discard, this.rng);
      this.discard = [];
    }
    const hand = this.draw.splice(0, count);
    return hand;
  }

  discardCards(cards: readonly CardDef[]): void {
    this.discard.push(...cards);
  }
}
