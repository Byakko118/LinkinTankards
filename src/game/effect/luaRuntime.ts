import * as WasmoonNS from 'wasmoon';
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import { createFxApi, type FxHostState } from './fxHost';
import { sideForLua } from './luaBridge';

/** Soft wall-clock budget; Wasmoon count-hook checks every 1000 instructions. */
const SCRIPT_TIMEOUT_MS = 50;

type LuaFactoryCtor = typeof import('wasmoon').LuaFactory;
type LuaEngine = import('wasmoon').LuaEngine;

/** wasmoon is CJS (`exports.LuaFactory`). Named ESM import fails unless Vite prebundles it. */
function resolveLuaFactory(): LuaFactoryCtor {
  const ns = WasmoonNS as unknown as {
    LuaFactory?: LuaFactoryCtor;
    default?: { LuaFactory?: LuaFactoryCtor } | LuaFactoryCtor;
  };
  const fromDefault =
    typeof ns.default === 'function'
      ? undefined
      : ns.default && typeof ns.default === 'object'
        ? ns.default.LuaFactory
        : undefined;
  const Factory = ns.LuaFactory ?? fromDefault;
  if (!Factory) {
    throw new Error('wasmoon LuaFactory export missing (CJS/ESM interop)');
  }
  return Factory;
}

const LuaFactory = resolveLuaFactory();

/** Browser: Vite `?url`. Node/vite-node: absolute file URL (root-relative `/node_modules/...` breaks on Windows). */
function resolveGlueWasm(): string {
  if (typeof window !== 'undefined') return glueWasmUrl;
  const cwd =
    (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? '';
  const path = `${cwd.replace(/\\/g, '/')}/node_modules/wasmoon/dist/glue.wasm`;
  return path.startsWith('/') ? `file://${path}` : `file:///${path}`;
}

let factory: InstanceType<LuaFactoryCtor> | null = null;
function getFactory(): InstanceType<LuaFactoryCtor> {
  if (!factory) factory = new LuaFactory(resolveGlueWasm());
  return factory;
}

const SANDBOX_STRIP = `
io = nil
os = nil
package = nil
require = nil
dofile = nil
loadfile = nil
load = nil
collectgarbage = nil
rawget = nil
rawset = nil
rawequal = nil
rawlen = nil
debug = nil
if math then
  math.random = nil
  math.randomseed = nil
end
`;

async function createSandboxedEngine(): Promise<LuaEngine> {
  const lua = await getFactory().createEngine({
    openStandardLibs: true,
    injectObjects: true,
    enableProxy: false,
    functionTimeout: SCRIPT_TIMEOUT_MS,
  });
  await lua.doString(SANDBOX_STRIP);
  return lua;
}

function whichSide(state: FxHostState, side: unknown, selfSnap: unknown, enemySnap: unknown) {
  if (side === enemySnap || side === 'enemy') return state.view.enemy;
  if (side === selfSnap || side === 'self') return state.view.self;
  return state.actor === 'enemy' ? state.view.enemy : state.view.self;
}

export interface RunHookArgs {
  state: FxHostState;
  script: string;
  hookName: 'on_score' | 'on_clash';
  label: string;
}

/**
 * Compile card script, inject fx allow-list, pcall the named hook.
 * Failures log and no-op (do not soft-lock resolve).
 */
export async function runCardHook(args: RunHookArgs): Promise<void> {
  const { state, script, hookName, label } = args;
  let lua: LuaEngine | null = null;
  try {
    lua = await createSandboxedEngine();
    const host = createFxApi(state);

    let selfSnap = sideForLua(state.view.self.view);
    let enemySnap = sideForLua(state.view.enemy.view);

    const actorSnap = () => (state.actor === 'enemy' ? enemySnap : selfSnap);
    const foeSnap = () => (state.actor === 'enemy' ? selfSnap : enemySnap);

    const fxTable: Record<string, unknown> = {
      channels: host.channels,
      self: selfSnap,
      enemy: enemySnap,
      outgoing: (card: unknown, opts?: { skip?: string; only?: string }) => host.outgoing(card, opts),
      slot: (side: unknown, i: number) => {
        const built = whichSide(state, side, selfSnap, enemySnap);
        const snap = sideForLua(built.view);
        return (snap.line as { cards: unknown[] }).cards[i - 1] ?? null;
      },
      hand: (side: unknown) => sideForLua(whichSide(state, side, selfSnap, enemySnap).view).hand,
      unplayed: (side: unknown) => {
        const hand = sideForLua(whichSide(state, side, selfSnap, enemySnap).view).hand as {
          unplayed: unknown;
        };
        return hand.unplayed;
      },
      draw_count: (side: unknown) => whichSide(state, side, selfSnap, enemySnap).view.draw.count,
      discard_count: (side: unknown) =>
        whichSide(state, side, selfSnap, enemySnap).view.discard.count,
      draw_cards: (side: unknown) =>
        host.draw_cards(whichSide(state, side, selfSnap, enemySnap).id),
      discard_cards: (side: unknown) =>
        host.discard_cards(whichSide(state, side, selfSnap, enemySnap).id),
      add: (card: unknown, amount: number, channel: string) => host.add(card, amount, channel),
      deal: (targetHp: number, amount: number, channel: string, source?: unknown) =>
        host.deal(targetHp, amount, channel, source),
      block_slot: (slot: number, amount: number) => host.block_slot(slot, amount),

      // Starter-friendly sugar — same power as fx.self.* / fx.add / …
      my_line: () => (actorSnap() as { line: unknown }).line,
      my_slot: () => (actorSnap() as { slot: number | null }).slot,
      my_card: () => {
        const snap = actorSnap() as { slot: number | null; line: { cards: unknown[] } };
        if (snap.slot == null) return null;
        return snap.line.cards[snap.slot - 1] ?? null;
      },
      line_cards: () => (actorSnap() as { line: { cards: unknown[] } }).line.cards,
      my_chain: () => (actorSnap() as { chain: unknown }).chain,
      empty_slots: () => (actorSnap() as { line: { empty: number } }).line.empty,
      enemy_at_my_slot: () => {
        const me = actorSnap() as { slot: number | null };
        if (me.slot == null) return null;
        const foe = foeSnap() as { line: { cards: unknown[] } };
        return foe.line.cards[me.slot - 1] ?? null;
      },
      add_to_me: (amount: number) => host.add_to_me(amount),
      deal_to_enemy: (amount: number) => host.deal_to_enemy(amount),
      block_me: (amount: number) => host.block_me(amount),
    };

    const refreshSnaps = () => {
      selfSnap = sideForLua(state.view.self.view);
      enemySnap = sideForLua(state.view.enemy.view);
      fxTable.self = selfSnap;
      fxTable.enemy = enemySnap;
    };
    refreshSnaps();

    lua.global.set('fx', fxTable);
    await lua.doString(script);

    const hook = lua.global.get(hookName);
    if (typeof hook !== 'function') {
      state.log.push(`${label}: missing ${hookName}()`);
      return;
    }

    refreshSnaps();
    lua.global.set('fx', fxTable);
    lua.global.setTimeout(Date.now() + SCRIPT_TIMEOUT_MS);

    await lua.doString(`
      local ok, err = pcall(${hookName}, fx)
      if not ok then error(tostring(err)) end
    `);
    state.log.push(`${label}: ${hookName} ok`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(`${label}: ${msg}`);
    state.log.push(`${label}: FAILED — ${msg}`);
  } finally {
    try {
      lua?.global.close();
    } catch {
      /* ignore */
    }
  }
}
