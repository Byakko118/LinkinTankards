import type { FxHostState } from './fxHost';
import { runCardHook } from './luaRuntime';
import {
  buildResolveView,
  setPulse,
  syncOutgoing,
  type BuiltSide,
} from './resolveView';
import type {
  CardChannelSnapshot,
  MockResolveInput,
  ResolveRunResult,
  ScriptedCardDef,
} from './types';

function snapshotCards(side: BuiltSide): CardChannelSnapshot[] {
  return side.lineCards.map((c) => ({
    id: c.view.id,
    name: c.view.name,
    type: c.view.type,
    slot: c.view.slot ?? 0,
    side: c.view.side,
    hop: c.mutable.hop,
    streak: c.mutable.streak,
    effect: c.mutable.effect,
    outgoing: c.mutable.hop + c.mutable.streak + c.mutable.effect,
  }));
}

function padBlocks(blocks: number[], len: number): number[] {
  const out = blocks.slice();
  while (out.length < len) out.push(0);
  return out;
}

async function runScorePass(state: FxHostState, side: BuiltSide, overrideScript?: {
  slot: number;
  def: ScriptedCardDef;
}): Promise<void> {
  state.phase = 'score';
  state.actor = side.id;
  state.log.push(`— SCORE ${side.id} —`);

  for (let i = 0; i < side.lineCards.length; i++) {
    const slot = i + 1;
    const card = side.lineCards[i];
    let def = card.def;
    if (overrideScript && overrideScript.slot === slot && side.id === 'self') {
      def = overrideScript.def;
      card.def = def;
    }
    if (!def || !def.hooks.includes('score') || !def.script.trim()) continue;

    setPulse(side, slot);
    const label = `${def.name ?? def.id} @${side.id}#${slot}`;
    await runCardHook({
      state,
      script: def.script,
      hookName: 'on_score',
      label,
    });
  }
  setPulse(side, null);
  syncOutgoing(side);
}

async function runClashPass(state: FxHostState, side: BuiltSide, overrideScript?: {
  slot: number;
  def: ScriptedCardDef;
}): Promise<void> {
  state.phase = 'clash';
  state.actor = side.id;
  state.log.push(`— CLASH ${side.id} —`);

  for (let i = 0; i < side.lineCards.length; i++) {
    const slot = i + 1;
    const card = side.lineCards[i];
    let def = card.def;
    if (overrideScript && overrideScript.slot === slot && side.id === 'self') {
      def = overrideScript.def;
      card.def = def;
    }
    if (!def || !def.hooks.includes('clash') || !def.script.trim()) continue;

    setPulse(side, slot);
    const label = `${def.name ?? def.id} @${side.id}#${slot}`;
    await runCardHook({
      state,
      script: def.script,
      hookName: 'on_clash',
      label,
    });
  }
  setPulse(side, null);
}

function applyHits(state: FxHostState): {
  hitsOnSelf: number[];
  hitsOnEnemy: number[];
  selfHpAfter: number;
  enemyHpAfter: number;
} {
  state.phase = 'apply';
  state.log.push('— APPLY —');

  const selfSlots = Math.max(
    state.view.self.lineCards.length,
    state.view.enemy.lineCards.length,
    state.blocks.self.length,
    state.blocks.enemy.length,
  );

  const hitsOnSelf: number[] = [];
  const hitsOnEnemy: number[] = [];

  for (let i = 0; i < selfSlots; i++) {
    const enemyOut = state.view.enemy.lineCards[i];
    const selfOut = state.view.self.lineCards[i];
    const enemyOutgoing = enemyOut
      ? enemyOut.mutable.hop + enemyOut.mutable.streak + enemyOut.mutable.effect
      : 0;
    const selfOutgoing = selfOut
      ? selfOut.mutable.hop + selfOut.mutable.streak + selfOut.mutable.effect
      : 0;
    const blockSelf = state.blocks.self[i] ?? 0;
    const blockEnemy = state.blocks.enemy[i] ?? 0;
    const hitSelf = Math.max(0, enemyOutgoing - blockSelf);
    const hitEnemy = Math.max(0, selfOutgoing - blockEnemy);
    hitsOnSelf.push(hitSelf);
    hitsOnEnemy.push(hitEnemy);
    if (hitSelf || hitEnemy || blockSelf || blockEnemy) {
      state.log.push(
        `slot ${i + 1}: enemy→self ${enemyOutgoing}−${blockSelf}=${hitSelf}; self→enemy ${selfOutgoing}−${blockEnemy}=${hitEnemy}`,
      );
    }
  }

  const slotHitsSelf = hitsOnSelf.reduce((a, b) => a + b, 0);
  const slotHitsEnemy = hitsOnEnemy.reduce((a, b) => a + b, 0);
  const selfHpAfter = state.view.self.hp - slotHitsSelf - state.deals.toSelf;
  const enemyHpAfter = state.view.enemy.hp - slotHitsEnemy - state.deals.toEnemy;

  state.log.push(
    `direct deals: →enemy ${state.deals.toEnemy}, →self ${state.deals.toSelf}`,
  );
  state.log.push(`HP self ${state.view.self.hp}→${selfHpAfter}; enemy ${state.view.enemy.hp}→${enemyHpAfter}`);

  return { hitsOnSelf, hitsOnEnemy, selfHpAfter, enemyHpAfter };
}

export interface RunResolveOptions {
  /** Editor: replace / inject scripted def onto self line at slot (1-based). */
  editorCard?: { slot: number; def: ScriptedCardDef };
}

/** SCORE → CLASH → APPLY against a mock ResolveView. */
export async function runMockResolve(
  input: MockResolveInput,
  options: RunResolveOptions = {},
): Promise<ResolveRunResult> {
  const view = buildResolveView(input);
  const state: FxHostState = {
    view,
    phase: 'score',
    actor: 'self',
    log: [],
    blocks: { self: [], enemy: [] },
    deals: { toSelf: 0, toEnemy: 0 },
    errors: [],
  };

  const override = options.editorCard;

  // SCORE each side alone (no reading other side's script outputs mid-score)
  await runScorePass(state, view.self, override);
  await runScorePass(state, view.enemy);

  // Freeze outgoing for clash
  syncOutgoing(view.self);
  syncOutgoing(view.enemy);

  await runClashPass(state, view.self, override);
  await runClashPass(state, view.enemy);

  const applied = applyHits(state);

  return {
    log: state.log,
    selfCards: snapshotCards(view.self),
    enemyCards: snapshotCards(view.enemy),
    selfBlocks: padBlocks(state.blocks.self, view.self.lineCards.length),
    enemyBlocks: padBlocks(state.blocks.enemy, view.enemy.lineCards.length),
    dealsToEnemy: state.deals.toEnemy,
    dealsToSelf: state.deals.toSelf,
    hitsOnSelf: applied.hitsOnSelf,
    hitsOnEnemy: applied.hitsOnEnemy,
    selfHpAfter: applied.selfHpAfter,
    enemyHpAfter: applied.enemyHpAfter,
    errors: state.errors,
  };
}
