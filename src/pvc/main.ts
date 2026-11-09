import '../style.css';
import './pvc.css';
import { BoardPhase, GameBoard } from '../game/board';
import { AiDifficulty, SLIP_RATE, STREAK_MISS_RATE, planAiLine } from '../game/ai';
import { BREAK_RECOIL, DAMAGE_UNIT, LOW_HP, STARTING_HP, hopDamageFromLinks } from '../game/hopDamage';
import { evaluateLinks } from '../game/rules';
import { SeededRng } from '../game/rng';
import { HAND_SIZE, TavernPile } from '../game/tavernDeck';

const START_HP = STARTING_HP;

type Side = 'player' | 'cpu';

const setupEl = document.getElementById('match-setup')!;
const liveEl = document.getElementById('match-live')!;
const resultEl = document.getElementById('match-result')!;
const boardHost = document.getElementById('board-host')!;
const fighterEls: Record<Side, HTMLElement> = {
  player: document.getElementById('fighter-player')!,
  cpu: document.getElementById('fighter-cpu')!,
};
const hpEls: Record<Side, HTMLElement> = {
  player: document.getElementById('hp-player')!,
  cpu: document.getElementById('hp-cpu')!,
};
const roundEl = document.getElementById('round-value')!;
const roundPill = document.querySelector<HTMLElement>('.round-pill')!;
const turnBanner = document.getElementById('turn-banner')!;
const phaseTrack = document.getElementById('phase-track')!;
const linksEl = document.getElementById('links-value')!;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnCommit = document.getElementById('btn-commit') as HTMLButtonElement;
const btnFast = document.getElementById('btn-fast') as HTMLButtonElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnRematch = document.getElementById('btn-rematch') as HTMLButtonElement;
const resultTitle = document.getElementById('result-title')!;
const resultDetail = document.getElementById('result-detail')!;
const diffRow = document.querySelector<HTMLElement>('.difficulty-row')!;
const diffBlurb = document.getElementById('diff-blurb')!;
const cpuDiffEl = document.getElementById('cpu-diff')!;

let difficulty: AiDifficulty = 'normal';
let board!: GameBoard;
let busy = false;
let playerHp = START_HP;
let cpuHp = START_HP;
let round = 1;
let shownRound = 1;
let matchSeed = 0;
let rng!: SeededRng;
let playerPile!: TavernPile;
let cpuPile!: TavernPile;
let fastForward = false;
let matchOver = false;
let activeSide: Side = 'player';

const shownHp: Record<Side, number> = { player: START_HP, cpu: START_HP };

function restartClass(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

// ——— Difficulty picker ———

const DIFF_LABEL: Record<AiDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

function placeDiffThumb(animate: boolean): void {
  const btn = diffRow.querySelector<HTMLElement>('.diff-btn.selected');
  if (!btn) return;
  diffRow.classList.toggle('no-anim', !animate);
  diffRow.style.setProperty('--thumb-x', `${btn.offsetLeft}px`);
  diffRow.style.setProperty('--thumb-w', `${btn.offsetWidth}px`);
}

function selectDifficulty(diff: AiDifficulty, animate: boolean): void {
  difficulty = diff;
  diffRow.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach((b) => {
    const on = b.dataset.diff === diff;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('role', 'radio');
  });
  const btn = diffRow.querySelector('.diff-btn.selected');
  if (btn && animate) restartClass(btn, 'pop');
  placeDiffThumb(animate);
  diffBlurb.textContent = `Tavern rival · slips 1 turn in ${Math.round(1 / SLIP_RATE[diff])} · misses Streak 1 in ${Math.round(1 / STREAK_MISS_RATE[diff])}`;
  if (animate) restartClass(diffBlurb, 'swap');
}

diffRow.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectDifficulty((btn.dataset.diff as AiDifficulty) ?? 'normal', true));
});
selectDifficulty('normal', false);
window.addEventListener('resize', () => placeDiffThumb(false));
void document.fonts.ready.then(() => placeDiffThumb(false));

// ——— HP / round / banner ———

function setHpInstant(side: Side, hp: number): void {
  const el = fighterEls[side];
  shownHp[side] = hp;
  hpEls[side].textContent = String(hp);
  el.classList.add('no-anim');
  el.style.setProperty('--hp', String(hp / START_HP));
  el.classList.remove('hit', 'recoil', 'ko');
  el.classList.toggle('low', hp > 0 && hp <= LOW_HP);
  void el.offsetWidth;
  el.classList.remove('no-anim');
}

function popDelta(side: Side, amount: number, kind: 'hit' | 'recoil'): void {
  const pop = document.createElement('span');
  pop.className = `hp-pop ${kind}`;
  pop.textContent = kind === 'recoil' ? `−${amount} recoil` : `−${amount}`;
  fighterEls[side].querySelector('.hp-pops')!.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
}

/** Bar drops at once (white ghost trails it); the number counts down in DAMAGE_UNIT steps. */
async function animateHp(side: Side, to: number, kind: 'hit' | 'recoil'): Promise<void> {
  const el = fighterEls[side];
  const from = shownHp[side];
  if (to >= from) {
    setHpInstant(side, to);
    return;
  }
  popDelta(side, from - to, kind);
  restartClass(el, kind);
  el.style.setProperty('--hp', String(to / START_HP));
  // Same tick count as the old 1-HP scale: one tick per DAMAGE_UNIT.
  for (let hp = from - DAMAGE_UNIT; hp > to; hp -= DAMAGE_UNIT) {
    await wait(fastForward ? 35 : 85);
    shownHp[side] = hp;
    hpEls[side].textContent = String(hp);
    restartClass(hpEls[side], 'tick');
  }
  shownHp[side] = to;
  hpEls[side].textContent = String(to);
  restartClass(hpEls[side], 'tick');
  el.classList.toggle('low', to > 0 && to <= LOW_HP);
  el.classList.toggle('ko', to <= 0);
  window.setTimeout(() => el.classList.remove(kind), 260);
}

function paintRound(): void {
  roundEl.textContent = String(round);
  if (round !== shownRound) {
    shownRound = round;
    restartClass(roundPill, 'bump');
  }
}

function setBanner(text: string, tone: 'you' | 'cpu' | 'final' | 'overtime'): void {
  turnBanner.textContent = text;
  turnBanner.classList.remove('you', 'cpu', 'final', 'overtime');
  turnBanner.classList.add(tone);
  if (tone === 'final') turnBanner.classList.add('cpu');
  restartClass(turnBanner, 'enter');
}

function setActive(side: Side): void {
  activeSide = side;
  fighterEls.player.classList.toggle('active', side === 'player');
  fighterEls.cpu.classList.toggle('active', side === 'cpu');
  phaseTrack.dataset.side = side;
}

// ——— HUD ———

const PHASE_STEPS = ['deal', 'build', 'resolve', 'score'] as const;
const STEP_OF: Record<BoardPhase, (typeof PHASE_STEPS)[number]> = {
  empty: 'deal',
  building: 'build',
  resolving: 'resolve',
  resolved: 'score',
};

function paintPhase(phase: BoardPhase): void {
  const step = STEP_OF[phase];
  const idx = PHASE_STEPS.indexOf(step);
  if (phaseTrack.dataset.step === step) return;
  phaseTrack.dataset.step = step;
  phaseTrack.style.setProperty('--i', String(idx));
  phaseTrack.querySelectorAll<HTMLElement>('.phase-step').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('done', i < idx);
  });
}

function paintHud(): void {
  const snap = board.snapshot;
  paintPhase(snap.phase);
  linksEl.textContent = snap.linksLabel;
  const building = snap.phase === 'building' && !busy && !matchOver && activeSide === 'player';
  btnClear.disabled = !building || snap.playCount === 0;
  btnCommit.disabled = !building || snap.playCount < 1;
  btnCommit.classList.toggle('ready', !btnCommit.disabled);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(): number {
  if (fastForward) return 80;
  return 500 + Math.floor(rng.next() * 400);
}

function maybeRethinkSwap(lineLength: number): boolean {
  if (lineLength < 2 || fastForward) return false;
  return rng.next() < 0.12;
}

/** KO check at round end (after human + CPU attacks). */
function roundEndVerdict(): 'player' | 'cpu' | 'overtime' | null {
  if (playerHp > 0 && cpuHp > 0) return null;
  if (playerHp <= 0 && cpuHp <= 0) {
    if (playerHp === cpuHp) return 'overtime';
    return playerHp > cpuHp ? 'player' : 'cpu';
  }
  if (playerHp <= 0) return 'cpu';
  return 'player';
}

function showResult(winner: 'player' | 'cpu'): void {
  matchOver = true;
  liveEl.classList.add('hidden');
  resultEl.classList.remove('hidden', 'win', 'loss');
  resultEl.classList.add(winner === 'player' ? 'win' : 'loss');
  resultTitle.textContent = winner === 'player' ? 'Victory' : 'Defeat';
  resultDetail.textContent = `Round ${round} · You ${playerHp} — CPU ${cpuHp} · Seed ${matchSeed}`;
}

/** Recoil ticks on the Break beat (before the ink); hop damage lands after the score stamp. */
async function resolveAttack(attacker: Side): Promise<void> {
  const defender: Side = attacker === 'player' ? 'cpu' : 'player';
  const damage = hopDamageFromLinks(evaluateLinks(board.getPlayCards()));
  await board.resolve({
    damageMode: 'hops',
    onRecoil: () => {
      if (attacker === 'player') playerHp = Math.max(0, playerHp - BREAK_RECOIL);
      else cpuHp = Math.max(0, cpuHp - BREAK_RECOIL);
      return animateHp(attacker, attacker === 'player' ? playerHp : cpuHp, 'recoil');
    },
  });
  if (damage > 0) {
    if (defender === 'cpu') cpuHp = Math.max(0, cpuHp - damage);
    else playerHp = Math.max(0, playerHp - damage);
    await animateHp(defender, defender === 'cpu' ? cpuHp : playerHp, 'hit');
  }
  await wait(fastForward && attacker === 'cpu' ? 120 : 420);
}

async function resolvePlayerAttack(): Promise<void> {
  if (busy || matchOver) return;
  busy = true;
  restartClass(btnCommit, 'stamp');
  btnFast.classList.add('hidden');
  paintHud();
  await resolveAttack('player');
  playerPile.discardCards([...board.getPlayCards(), ...board.getHandCards()]);
  await board.discardAll();
  busy = false;
  await runCpuTurn();
}

async function runCpuTurn(): Promise<void> {
  const humanWasKo = cpuHp <= 0 && playerHp > 0;
  setBanner(humanWasKo ? "CPU's final swing" : 'CPU attack', humanWasKo ? 'final' : 'cpu');
  setActive('cpu');
  btnFast.classList.remove('hidden');
  btnFast.classList.toggle('engaged', fastForward);
  btnFast.textContent = fastForward ? 'Fast-forwarding ››' : 'Fast-forward CPU';

  board.setHandFaceDown(true);
  board.setInteractionAllowed(false);
  const hand = cpuPile.drawHand(HAND_SIZE);
  board.dealToHand(hand);
  paintHud();

  await wait(fastForward ? 150 : 500);
  const planned = planAiLine([...board.getHandCards()], difficulty, rng);
  let placed = 0;
  for (const card of planned) {
    if (fastForward) {
      board.playCardById(card.id);
    } else {
      await wait(jitteredDelay());
      if (placed >= 1 && maybeRethinkSwap(placed)) {
        const play = board.getPlayCards();
        if (play.length > 0) {
          board.clearPlayLine();
          await wait(220 + Math.floor(rng.next() * 180));
          for (const c of play) board.playCardById(c.id);
        }
      }
      board.playCardById(card.id);
    }
    placed += 1;
    paintHud();
  }

  await wait(fastForward ? 120 : 450);
  busy = true;
  btnFast.classList.add('hidden');
  paintHud();
  await resolveAttack('cpu');
  cpuPile.discardCards([...board.getPlayCards(), ...board.getHandCards()]);
  await board.discardAll();
  board.setHandFaceDown(false);
  board.setInteractionAllowed(true);
  busy = false;

  const end = roundEndVerdict();
  if (end === 'player' || end === 'cpu') {
    showResult(end);
    return;
  }
  if (end === 'overtime') {
    setBanner('Overtime — tied at KO', 'overtime');
    await wait(900);
  }

  round += 1;
  await startPlayerTurn();
}

async function startPlayerTurn(): Promise<void> {
  setBanner('Your attack', 'you');
  setActive('player');
  const hand = playerPile.drawHand(HAND_SIZE);
  board.dealToHand(hand);
  paintRound();
  paintHud();
}

async function startMatch(): Promise<void> {
  matchSeed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  rng = new SeededRng(matchSeed);
  playerPile = new TavernPile(rng.fork(0x70ae));
  cpuPile = new TavernPile(rng.fork(0xdead));
  playerHp = START_HP;
  cpuHp = START_HP;
  round = 1;
  shownRound = 1;
  matchOver = false;
  fastForward = false;
  busy = false;
  cpuDiffEl.textContent = DIFF_LABEL[difficulty];
  setupEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  liveEl.classList.remove('hidden');
  board.clear();
  setHpInstant('player', START_HP);
  setHpInstant('cpu', START_HP);
  paintRound();
  await startPlayerTurn();
}

btnStart.addEventListener('click', () => void startMatch());
btnRematch.addEventListener('click', () => {
  resultEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  requestAnimationFrame(() => placeDiffThumb(false));
});
btnClear.addEventListener('click', () => {
  if (busy || matchOver) return;
  board.clearPlayLine();
  paintHud();
});
btnCommit.addEventListener('click', () => void resolvePlayerAttack());
btnFast.addEventListener('click', () => {
  fastForward = true;
  btnFast.classList.add('engaged');
  btnFast.textContent = 'Fast-forwarding ››';
});

board = await GameBoard.create(boardHost, { cardDamage: false });
board.setChangeListener(() => paintHud());
paintHud();
