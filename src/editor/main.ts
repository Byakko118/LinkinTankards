import './style.css';
import {
  STARTER_CARDS,
  runMockResolve,
  starterById,
  type MockResolveInput,
  type ScriptedCardDef,
  type CardChannelSnapshot,
} from '../game/effect';
import type { CardType } from '../game/rules';
import { STARTING_HP } from '../game/hopDamage';

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

/** Default mocks that exercise each starter. `@` marks the edited card's seat. */
const SCENARIOS: Record<string, Scenario> = {
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

const starterEl = document.getElementById('starter') as HTMLSelectElement;
const hooksEl = document.getElementById('hooks') as HTMLInputElement;
const scriptEl = document.getElementById('script') as HTMLTextAreaElement;
const resetEl = document.getElementById('reset-script') as HTMLButtonElement;
const runEl = document.getElementById('run') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const channelsEl = document.getElementById('channels') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLPreElement;
const hintEl = document.getElementById('scenario-hint') as HTMLParagraphElement;

const selfLineEl = document.getElementById('self-line') as HTMLInputElement;
const selfUnplayedEl = document.getElementById('self-unplayed') as HTMLInputElement;
const selfDrawEl = document.getElementById('self-draw') as HTMLInputElement;
const selfDiscardEl = document.getElementById('self-discard') as HTMLInputElement;
const selfHpEl = document.getElementById('self-hp') as HTMLInputElement;
const capacityEl = document.getElementById('capacity') as HTMLInputElement;
const enemyLineEl = document.getElementById('enemy-line') as HTMLInputElement;
const enemyHpEl = document.getElementById('enemy-hp') as HTMLInputElement;
const enemyFacesEl = document.getElementById('enemy-faces') as HTMLInputElement;

function currentStarter(): ScriptedCardDef {
  return starterById(starterEl.value) ?? STARTER_CARDS[0];
}

function parseTypes(raw: string): CardType[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((t) => TYPES.has(t)) as CardType[];
}

/** Parse line tokens; `@` becomes the scripted card. Returns line + 1-based slot. */
function parseSelfLine(
  raw: string,
  card: ScriptedCardDef,
): { line: Array<CardType | ScriptedCardDef>; slot: number } {
  const tokens = raw.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return { line: [{ ...card, script: scriptEl.value }], slot: 1 };
  }
  const line: Array<CardType | ScriptedCardDef> = [];
  let slot = -1;
  for (const tok of tokens) {
    if (tok === '@') {
      slot = line.length + 1;
      line.push({ ...card, script: scriptEl.value });
    } else if (TYPES.has(tok)) {
      line.push(tok as CardType);
    }
  }
  if (slot < 0) {
    line.push({ ...card, script: scriptEl.value });
    slot = line.length;
  }
  return { line, slot };
}

function loadScenario(id: string): void {
  const card = starterById(id) ?? STARTER_CARDS[0];
  const sc = SCENARIOS[id] ?? SCENARIOS.thunderer;
  scriptEl.value = card.script;
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
}

function fmtCard(c: CardChannelSnapshot): string {
  const name = c.name ?? c.type;
  return `#${c.slot} ${name}(${c.type}) hop ${c.hop} / streak ${c.streak} / effect ${c.effect} → out ${c.outgoing}`;
}

function renderResult(result: Awaited<ReturnType<typeof runMockResolve>>): void {
  const bad = result.errors.length > 0;
  statusEl.className = `status ${bad ? 'bad' : 'ok'}`;
  statusEl.textContent = bad
    ? `Finished with ${result.errors.length} script error(s).`
    : 'Resolve complete.';

  const lines: string[] = [];
  lines.push('<div class="channel-row"><strong>Self</strong><span></span></div>');
  for (const c of result.selfCards) {
    lines.push(`<div class="channel-row"><span>slot ${c.slot}</span><span>${fmtCard(c)}</span></div>`);
  }
  if (result.selfBlocks.some((b) => b > 0)) {
    lines.push(
      `<div class="channel-row"><span>blocks</span><span>${result.selfBlocks.map((b, i) => `s${i + 1}:${b}`).join(' ')}</span></div>`,
    );
  }
  lines.push(
    `<div class="channel-row"><span>deals→enemy</span><span>${result.dealsToEnemy}</span></div>`,
  );
  lines.push(
    `<div class="channel-row"><span>HP</span><span>self ${result.selfHpAfter} / enemy ${result.enemyHpAfter}</span></div>`,
  );
  if (result.enemyCards.length) {
    lines.push('<div class="channel-row"><strong>Enemy</strong><span></span></div>');
    for (const c of result.enemyCards) {
      lines.push(`<div class="channel-row"><span>slot ${c.slot}</span><span>${fmtCard(c)}</span></div>`);
    }
  }
  channelsEl.innerHTML = lines.join('');
  logEl.textContent = result.log.join('\n');
}

async function run(): Promise<void> {
  const card = currentStarter();
  const edited: ScriptedCardDef = {
    ...card,
    script: scriptEl.value,
    hooks: hooksEl.value
      .split(/[,\s]+/)
      .map((h) => h.trim())
      .filter(Boolean) as ScriptedCardDef['hooks'],
  };
  if (!edited.hooks.length) edited.hooks = [...card.hooks];

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
    const result = await runMockResolve(input, {
      editorCard: { slot, def: edited },
    });
    renderResult(result);
  } catch (err) {
    statusEl.className = 'status bad';
    statusEl.textContent = err instanceof Error ? err.message : String(err);
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

scriptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = scriptEl.selectionStart;
    const end = scriptEl.selectionEnd;
    scriptEl.value = `${scriptEl.value.slice(0, start)}  ${scriptEl.value.slice(end)}`;
    scriptEl.selectionStart = scriptEl.selectionEnd = start + 2;
  }
});

loadScenario(STARTER_CARDS[0].id);
