import { STARTER_CARDS, runMockResolve } from '../src/game/effect/index.ts';

async function main() {
  const byId = Object.fromEntries(STARTER_CARDS.map((c) => [c.id, c]));

  const cases = [
    {
      name: 'Thunderer',
      input: {
        self: { hp: 2800, line: ['S' as const, byId.thunderer, 'S' as const], hideFaces: false },
        enemy: { hp: 2800, line: [] as const[], hideFaces: true },
      },
      expect: (r: Awaited<ReturnType<typeof runMockResolve>>) =>
        r.selfCards[1]?.effect === 100 ? null : `effect=${r.selfCards[1]?.effect}`,
    },
    {
      name: 'Golem',
      input: {
        self: { hp: 2800, line: ['G' as const, 'G' as const, byId.golem], hideFaces: false },
        enemy: { hp: 2800, line: [] as const[], hideFaces: true },
      },
      expect: (r: Awaited<ReturnType<typeof runMockResolve>>) =>
        r.selfCards[2]?.effect === 150 ? null : `effect=${r.selfCards[2]?.effect}`,
    },
    {
      name: 'Sprinter',
      input: {
        self: { hp: 2800, line: ['K' as const, byId.sprinter, 'S' as const], hideFaces: false },
        enemy: { hp: 2800, line: [] as const[], hideFaces: true },
      },
      expect: (r: Awaited<ReturnType<typeof runMockResolve>>) =>
        r.selfCards[1]?.effect === 60 ? null : `effect=${r.selfCards[1]?.effect}`,
    },
    {
      name: 'Burnt Offering',
      input: {
        self: {
          hp: 2800,
          line: [byId['burnt-offering'], 'G' as const],
          lineCapacity: 5,
          hideFaces: false,
        },
        enemy: { hp: 2800, line: [] as const[], hideFaces: true },
      },
      expect: (r: Awaited<ReturnType<typeof runMockResolve>>) =>
        r.dealsToEnemy === 300 ? null : `deals=${r.dealsToEnemy}`,
    },
    {
      name: 'Shield',
      input: {
        self: { hp: 2800, line: ['G' as const, byId.shield], hideFaces: false },
        enemy: { hp: 2800, line: ['G' as const, 'G' as const], hideFaces: false },
      },
      expect: (r: Awaited<ReturnType<typeof runMockResolve>>) =>
        r.selfBlocks[1] === 50 ? null : `block=${r.selfBlocks[1]} hits=${JSON.stringify(r.hitsOnSelf)}`,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const r = await runMockResolve(c.input as Parameters<typeof runMockResolve>[0]);
    const err = c.expect(r);
    if (r.errors.length || err) {
      failed += 1;
      console.error(`FAIL ${c.name}`, { err, errors: r.errors, log: r.log });
    } else {
      console.log(`ok ${c.name}`);
    }
  }
  if (failed) {
    process.exitCode = 1;
    console.error(`${failed} failed`);
  } else {
    console.log('all five starters ok');
  }
}

void main();
