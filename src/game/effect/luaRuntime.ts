import { LuaFactory, type LuaEngine } from 'wasmoon';
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import { createFxApi, type FxHostState } from './fxHost';
import { sideForLua } from './luaBridge';

/** Soft wall-clock budget; Wasmoon count-hook checks every 1000 instructions. */
const SCRIPT_TIMEOUT_MS = 50;

/** Browser: Vite `?url`. Node/vite-node: absolute file URL (root-relative `/node_modules/...` breaks on Windows). */
function resolveGlueWasm(): string {
  if (typeof window !== 'undefined') return glueWasmUrl;
  // Avoid `process` types — read cwd from Vite-node / Node global when present.
  const cwd =
    (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ??
    '';
  const path = `${cwd.replace(/\\/g, '/')}/node_modules/wasmoon/dist/glue.wasm`;
  return path.startsWith('/') ? `file://${path}` : `file:///${path}`;
}

const FACTORY = new LuaFactory(resolveGlueWasm());

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
  const lua = await FACTORY.createEngine({
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
