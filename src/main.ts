import './style.css';
import { setAttackFreezeOnContact, setAttackTimeScale } from './game/attacks';
import { GameBoard } from './game/board';
import { CardDef, CardType, buildDeck, drawHand, makeCard } from './game/rules';

const host = document.getElementById('board-host');
const turnNode = document.getElementById('turn-value');
const damageNode = document.getElementById('damage-value');
const linksNode = document.getElementById('links-value');
const btnDeal = document.getElementById('btn-deal') as HTMLButtonElement;
const btnRedraw = document.getElementById('btn-redraw') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnResolve = document.getElementById('btn-resolve') as HTMLButtonElement;
const btnNext = document.getElementById('btn-next') as HTMLButtonElement;

if (!host || !turnNode || !damageNode || !linksNode) {
  throw new Error('Missing HUD elements');
}

const turnEl = turnNode;
const damageEl = damageNode;
const linksEl = linksNode;

const params = new URLSearchParams(window.location.search);
const demoMode = params.has('demo');
// ?score=hops scores like PvC (100 per hop + Streak) instead of printed card damage; streak demos imply it.
const hopScoring = params.get('score') === 'hops' || (params.get('demo') ?? '').startsWith('streak');

// Tuning/capture hooks: ?slow=0.25 slow-mo; ?freeze=20 holds a hop 20 ms after contact
// (&freezeSkip=2 lets the first two hops play through and freezes the third).
if (params.has('slow')) setAttackTimeScale(Number(params.get('slow')) || 1);
if (params.has('freeze')) {
  setAttackFreezeOnContact(Number(params.get('freeze')) || 0, Number(params.get('freezeSkip')) || 0);
}

/** Valid directed zigzag: G → K → A → S → G (ground→air→air→ground→ground). */
function demoPlayTypes(): CardType[] {
  return ['G', 'K', 'A', 'S', 'G'];
}

/** Illegal G→A as first break (Ground cannot go straight to Air). */
function demoBreakTypes(): CardType[] {
  return ['G', 'A', 'S', 'K', 'G'];
}

/** Illegal S→A after a valid climb (G→K→S then break). */
function demoBreakSaTypes(): CardType[] {
  return ['G', 'K', 'S', 'A', 'G'];
}

/** Shows G→G ground keep + A→A air keep alongside lift. */
function demoKeepsTypes(): CardType[] {
  return ['G', 'G', 'K', 'A', 'A'];
}

/** Lane ping-pong: launch, meteor down, spring back up, air keep (G→K→S→K→A). */
function demoReboundTypes(): CardType[] {
  return ['G', 'K', 'S', 'K', 'A'];
}

/** Full juggle: three streak hops in a row (4 hops + 3 streak = 700). */
function demoStreakTypes(): CardType[] {
  return ['S', 'K', 'S', 'K', 'S'];
}

/** Ground press run into a launch: one streak hop (G→G→G), then K→A. */
function demoStreakPressTypes(): CardType[] {
  return ['G', 'G', 'G', 'K', 'A'];
}

let board: GameBoard;
let deck: CardDef[] = buildDeck();
let turn = 1;
let busy = false;

function paintHud(): void {
  const snap = board.snapshot;
  turnEl.textContent = String(turn);
  damageEl.textContent = snap.damageLabel;
  linksEl.textContent = snap.linksLabel;

  const building = snap.phase === 'building';
  const resolved = snap.phase === 'resolved';
  const empty = snap.phase === 'empty';

  btnDeal.disabled = busy || !empty;
  btnRedraw.disabled = busy || !building;
  btnClear.disabled = busy || !building || snap.playCount === 0;
  // Rough loop: resolve with ≥1 card on the play line (need not play all 5).
  btnResolve.disabled = busy || !building || snap.playCount < 1;
  btnNext.disabled = busy || !resolved;
}

function allHeldCards(): CardDef[] {
  return [...board.getHandCards(), ...board.getPlayCards()];
}

async function deal(): Promise<void> {
  if (busy) return;
  busy = true;
  paintHud();
  const drawn = drawHand(deck, 5);
  deck = drawn.rest;
  board.dealToHand(drawn.hand);
  busy = false;
  paintHud();
}

async function redraw(): Promise<void> {
  if (busy || board.snapshot.phase !== 'building') return;
  busy = true;
  paintHud();
  deck = [...deck, ...allHeldCards()];
  const drawn = drawHand(deck, 5);
  deck = drawn.rest;
  board.dealToHand(drawn.hand);
  busy = false;
  paintHud();
}

function clearPlay(): void {
  if (busy || board.snapshot.phase !== 'building') return;
  board.clearPlayLine();
  paintHud();
}

async function resolve(): Promise<void> {
  if (busy || board.snapshot.phase !== 'building' || board.snapshot.playCount < 1) return;
  busy = true;
  paintHud();
  await board.resolve(hopScoring ? { damageMode: 'hops' } : undefined);
  busy = false;
  paintHud();
}

async function nextTurn(): Promise<void> {
  if (busy || board.snapshot.phase !== 'resolved') return;
  turn += 1;
  busy = true;
  paintHud();
  // Discard leftover hand + played cards for this rough loop.
  const drawn = drawHand(deck, 5);
  deck = drawn.rest;
  board.dealToHand(drawn.hand);
  busy = false;
  paintHud();
}

btnDeal.addEventListener('click', () => void deal());
btnRedraw.addEventListener('click', () => void redraw());
btnClear.addEventListener('click', () => clearPlay());
btnResolve.addEventListener('click', () => void resolve());
btnNext.addEventListener('click', () => void nextTurn());

board = await GameBoard.create(host, { cardDamage: !hopScoring });
board.setChangeListener(() => paintHud());
paintHud();

if (demoMode) {
  const mode = params.get('demo');
  const handOnly = mode === 'hand';
  const types =
    mode === 'break'
      ? demoBreakTypes()
      : mode === 'break-sa'
        ? demoBreakSaTypes()
        : mode === 'keeps'
          ? demoKeepsTypes()
          : mode === 'rebound'
            ? demoReboundTypes()
            : mode === 'streak'
              ? demoStreakTypes()
              : mode === 'streak-press'
                ? demoStreakPressTypes()
                : demoPlayTypes();
  const cards = types.map((t) => makeCard(t));
  if (handOnly) {
    // Hand strip filled, play line empty — for build-UI screenshots.
    board.dealToHand(cards);
  } else {
    board.dealAndPlay(cards, cards);
  }
  if (params.get('auto') === 'resolve' && !handOnly) {
    await resolve();
  }
} else {
  await deal();
}
