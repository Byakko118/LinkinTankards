/** Mulberry32 — seeded PRNG for reproducible deck shuffles. */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  fork(salt: number): SeededRng {
    return new SeededRng((this.state ^ salt) >>> 0);
  }
}

export function shuffleWithRng<T>(arr: readonly T[], rng: SeededRng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
