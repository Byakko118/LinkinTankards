import './style.css';
import { STARTER_CARDS, starterById } from '../game/effect/starters';
import type { MockResolveInput, ResolveRunResult, ScriptedCardDef } from '../game/effect/types';
import type { CardType } from '../game/rules';
import { STARTING_HP } from '../game/hopDamage';
import { mountDocsPanel } from './docsPanel';
import { KeyCode, KeyMod, createLuaEditor } from './monacoSetup';

const TYPES = new Set(['G', 'A', 'S', 'K']);

interface Scenario {
  hint: string;
  selfLine: string;
  selfUnplayed: string;
  selfDraw: string;
  selfDiscard: string;
  enemyLine: string;
  capacity: number;
  enemyFaces: boolean;
}

/** Default mocks. `@` marks the edited card's seat. */
const SCENARIOS: Record<string, Scenario> = {
  blank: {
    hint: 'Blank template on a single G — safe canvas for new effects.',
    selfLine: '@',
    selfUnplayed: 'A S K',
    selfDraw: 'G',
    selfDiscard: '',
    enemyLine: '',
    capacity: 5,
    enemyFaces: false,
  },
  thunderer: {
    hint: 'S→K→S triple with Thunderer as the middle K — expects +100 effect.',
    selfLine: 'S @ S',
    selfUnplayed: 'G A',
    selfDraw: 'G K',
    selfDiscard: 'A',
    enemyLine: '',
    capacity: 5,
    enemyFaces: false,
  },
  shield: {
    hint: 'Shield in slot 2 vs enemy G G (slot 2 has hop 100) — expects block 50 in CLASH.',
    selfLine: 'G @',
    selfUnplayed: 'A S',
    selfDraw: '',
    selfDiscard: '',
    enemyLine: 'G G',
    capacity: 5,
    enemyFaces: true,
  },
  golem: {
    hint: 'Golem on a G-G-G prefix — +50 per G in chain (3 → +150).',
    selfLine: 'G G @',
    selfUnplayed: 'K',
    selfDraw: 'S',
    selfDiscard: '',
    enemyLine: '',
    capacity: 5,
    enemyFaces: false,
  },
  sprinter: {
    hint: 'Sprinter on K→A→S — counts K+S on full line (2 → +60).',
    selfLine: 'K @ S',
    selfUnplayed: 'G G',
    selfDraw: '',
    selfDiscard: 'A',
    enemyLine: '',
    capacity: 5,
    enemyFaces: false,
  },
  'burnt-offering': {
    hint: 'Burnt Offering on a 2-card line (capacity 5) — 3 empties → 300 direct to enemy.',
    selfLine: '@ G',
    selfUnplayed: 'A K S',
    selfDraw: 'G',
    selfDiscard: '',
    enemyLine: '',
    capacity: 5,
    enemyFaces: false,
  },
};

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const starterEl = requireEl<HTMLSelectElement>('starter');
const hooksEl = requireEl<HTMLInputElement>('hooks');
const monacoHost = requireEl<HTMLDivElement>('monaco-host');
const docsPanel = requireEl<HTMLElement>('docs-panel');
const resetEl = requireEl<HTMLButtonElement>('reset-script');
const toggleDocsEl = requireEl<HTMLButtonElement>('toggle-docs');
const toggleFsEl = requireEl<HTMLButtonElement>('toggle-fullscreen');
const scriptChrome = requireEl<HTMLDivElement>('script-chrome');
const runEl = requireEl<HTMLButtonElement>('run');
const statusEl = requireEl<HTMLDivElement>('status');
const channelsEl = requireEl<HTMLDivElement>('channels');
const logEl = requireEl<HTMLPreElement>('log');
const hintEl = requireEl<HTMLParagraphElement>('scenario-hint');

const selfLineEl = requireEl<HTMLInputElement>('self-line');
const selfUnplayedEl = requireEl<HTMLInputElement>('self-unplayed');
const selfDrawEl = requireEl<HTMLInputElement>('self-draw');
const selfDiscardEl = requireEl<HTMLInputElement>('self-discard');
const selfHpEl = requireEl<HTMLInputElement>('self-hp');
const capacityEl = requireEl<HTMLInputElement>('capacity');
const enemyLineEl = requireEl<HTMLInputElement>('enemy-line');
const enemyHpEl = requireEl<HTMLInputElement>('enemy-hp');
const enemyFacesEl = requireEl<HTMLInputElement>('enemy-faces');

mountDocsPanel(docsPanel);

const WELCOME_KEY = 'lt-fx-welcome-dismissed';
const welcomeEl = document.getElementById('fx-welcome');
const welcomeDismissEl = document.getElementById('fx-welcome-dismiss');
if (welcomeEl && welcomeDismissEl) {
  try {
    if (localStorage.getItem(WELCOME_KEY) !== '1') {
      welcomeEl.hidden = false;
    }
  } catch {
    welcomeEl.hidden = false;
  }
  welcomeDismissEl.addEventListener('click', () => {
    welcomeEl.hidden = true;
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* ignore quota / private mode */
    }
  });
}

const blank = starterById('blank') ?? STARTER_CARDS[0];
const editor = createLuaEditor(monacoHost, blank.script);

function scriptValue(): string {
  return editor.getValue();
}

function currentStarter(): ScriptedCardDef {
  return starterById(starterEl.value) ?? blank;
}

function parseTypes(raw: string): CardType[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((t) => TYPES.has(t)) as CardType[];
}

function parseHooks(raw: string, fallback: ScriptedCardDef['hooks']): ScriptedCardDef['hooks'] {
  const hooks = raw
    .split(/[,\s]+/)
    .map((h) => h.trim())
    .filter(Boolean) as ScriptedCardDef['hooks'];
  return hooks.length ? hooks : [...fallback];
}

/** Parse line tokens; `@` becomes the scripted card. */
function parseSelfLine(
  raw: string,
  card: ScriptedCardDef,
): { line: Array<CardType | ScriptedCardDef>; slot: number } {
  const tokens = raw.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return { line: [{ ...card, script: scriptValue() }], slot: 1 };
  }
  const line: Array<CardType | ScriptedCardDef> = [];
  let slot = -1;
  for (const tok of tokens) {
    if (tok === '@') {
      slot = line.length + 1;
      line.push({ ...card, script: scriptValue() });
    } else if (TYPES.has(tok)) {
      line.push(tok as CardType);
    }
  }
  if (slot < 0) {
    line.push({ ...card, script: scriptValue() });
    slot = line.length;
  }
  return { line, slot };
}

function loadScenario(id: string): void {
  const card = starterById(id) ?? blank;
  const sc = SCENARIOS[id] ?? SCENARIOS.blank;
  editor.setValue(card.script);
  hooksEl.value = card.hooks.join(', ');
  selfLineEl.value = sc.selfLine;
  selfUnplayedEl.value = sc.selfUnplayed;
  selfDrawEl.value = sc.selfDraw;
  selfDiscardEl.value = sc.selfDiscard;
  enemyLineEl.value = sc.enemyLine;
  capacityEl.value = String(sc.capacity);
  enemyFacesEl.checked = sc.enemyFaces;
  selfHpEl.value = String(STARTING_HP);
  enemyHpEl.value = String(STARTING_HP);
  hintEl.textContent = sc.hint;
  editor.focus();
}

function txt(v: unknown, fallback = '—'): string {
  if (v == null) return fallback;
  return String(v);
}

function fmtCard(c: ResolveRunResult['selfCards'][number]): string {
  const name = c.name ?? c.type;
  return `#${txt(c.slot)} ${txt(name)}(${txt(c.type)}) hop ${txt(c.hop, '0')} / streak ${txt(c.streak, '0')} / effect ${txt(c.effect, '0')} → out ${txt(c.outgoing, '0')}`;
}

function row(label: string, value: string): string {
  return `<div class="channel-row"><span>${label}</span><span>${value}</span></div>`;
}

function renderResult(result: ResolveRunResult): void {
  const errors = result.errors ?? [];
  const bad = errors.length > 0;
  statusEl.className = `status ${bad ? 'bad' : 'ok'}`;
  statusEl.textContent = bad
    ? `Finished with ${errors.length} script error(s).`
    : 'Resolve complete.';

  const parts: string[] = [row('Self', '')];
  for (const c of result.selfCards ?? []) {
    parts.push(row(`slot ${txt(c.slot)}`, fmtCard(c)));
  }
  const selfBlocks = result.selfBlocks ?? [];
  if (selfBlocks.some((b) => b > 0)) {
    parts.push(row('blocks', selfBlocks.map((b, i) => `s${i + 1}:${b}`).join(' ')));
  }
  parts.push(row('deals→enemy', txt(result.dealsToEnemy, '0')));
  parts.push(row('HP', `self ${txt(result.selfHpAfter)} / enemy ${txt(result.enemyHpAfter)}`));
  if ((result.enemyCards ?? []).length) {
    parts.push(row('Enemy', ''));
    for (const c of result.enemyCards) {
      parts.push(row(`slot ${txt(c.slot)}`, fmtCard(c)));
    }
  }
  channelsEl.innerHTML = parts.join('');
  logEl.textContent = (result.log ?? []).join('\n') || '(empty log)';
}

async function run(): Promise<void> {
  const card = currentStarter();
  const edited: ScriptedCardDef = {
    ...card,
    script: scriptValue(),
    hooks: parseHooks(hooksEl.value, card.hooks),
  };

  const { line, slot } = parseSelfLine(selfLineEl.value, edited);
  const input: MockResolveInput = {
    self: {
      hp: Number(selfHpEl.value) || STARTING_HP,
      line,
      unplayed: parseTypes(selfUnplayedEl.value),
      draw: parseTypes(selfDrawEl.value),
      discard: parseTypes(selfDiscardEl.value),
      lineCapacity: Number(capacityEl.value) || 5,
      hideFaces: false,
    },
    enemy: {
      hp: Number(enemyHpEl.value) || STARTING_HP,
      line: parseTypes(enemyLineEl.value),
      hideFaces: !enemyFacesEl.checked,
    },
  };

  runEl.disabled = true;
  statusEl.className = 'status';
  statusEl.textContent = 'Running Lua sandbox…';
  logEl.textContent = '';
  channelsEl.innerHTML = '';

  try {
    const { runMockResolve } = await import('../game/effect/runResolve');
    const result = await runMockResolve(input, {
      editorCard: { slot, def: edited },
    });
    renderResult(result);
  } catch (err) {
    statusEl.className = 'status bad';
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    logEl.textContent = String(err);
  } finally {
    runEl.disabled = false;
  }
}

for (const c of STARTER_CARDS) {
  const opt = document.createElement('option');
  opt.value = c.id;
  opt.textContent = c.name;
  starterEl.appendChild(opt);
}

starterEl.addEventListener('change', () => loadScenario(starterEl.value));
resetEl.addEventListener('click', () => loadScenario(starterEl.value));
runEl.addEventListener('click', () => void run());
toggleDocsEl.addEventListener('click', () => {
  document.body.classList.toggle('docs-collapsed');
  // Monaco automaticLayout picks up size change on next frame
  requestAnimationFrame(() => editor.layout());
});

function isEditorFullscreen(): boolean {
  return document.fullscreenElement === scriptChrome || document.body.classList.contains('editor-fs');
}

function syncFullscreenChrome(): void {
  const on = isEditorFullscreen();
  document.body.classList.toggle('editor-fs', on);
  toggleFsEl.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
  toggleFsEl.setAttribute('aria-pressed', on ? 'true' : 'false');
  requestAnimationFrame(() => editor.layout());
}

async function enterFullscreen(): Promise<void> {
  try {
    if (scriptChrome.requestFullscreen) {
      await scriptChrome.requestFullscreen();
    } else {
      document.body.classList.add('editor-fs');
    }
  } catch {
    document.body.classList.add('editor-fs');
  }
  syncFullscreenChrome();
}

async function exitFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    /* ignore */
  }
  document.body.classList.remove('editor-fs');
  syncFullscreenChrome();
}

async function toggleFullscreen(): Promise<void> {
  if (isEditorFullscreen()) await exitFullscreen();
  else await enterFullscreen();
}

toggleFsEl.addEventListener('click', () => void toggleFullscreen());
document.addEventListener('fullscreenchange', () => syncFullscreenChrome());

window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'F11') return;
  ev.preventDefault();
  void toggleFullscreen();
});

editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => {
  void run();
});

loadScenario('blank');
starterEl.value = 'blank';
syncFullscreenChrome();
