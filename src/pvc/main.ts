import '../style.css';
import './pvc.css';
import { GameBoard } from '../game/board';
import { AiDifficulty, planAiLine } from '../game/ai';
import { hopDamageFromLinks } from '../game/hopDamage';
import { evaluateLinks, firstBreakIndex } from '../game/rules';
import { SeededRng } from '../game/rng';
import { TavernPile } from '../game/tavernDeck';

const START_HP = 20;

const setupEl = document.getElementById('match-setup')!;
const liveEl = document.getElementById('match-live')!;
const resultEl = document.getElementById('match-result')!;
const boardHost = document.getElementById('board-host')!;
const hpPlayerEl = document.getElementById('hp-player')!;
const hpCpuEl = document.getElementById('hp-cpu')!;
const roundEl = document.getElementById('round-value')!;
const turnBanner = document.getElementById('turn-banner')!;
const phaseEl = document.getElementById('phase-value')!;
const linksEl = document.getElementById('links-value')!;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnCommit = document.getElementById('btn-commit') as HTMLButtonElement;
const btnFast = document.getElementById('btn-fast') as HTMLButtonElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnRematch = document.getElementById('btn-rematch') as HTMLButtonElement;
const resultTitle = document.getElementById('result-title')!;
const resultDetail = document.getElementById('result-detail')!;

let difficulty: AiDifficulty = 'normal';
let board!: GameBoard;
let busy = false;
let playerHp = START_HP;
let cpuHp = START_HP;
let round = 1;
let matchSeed = 0;
let rng!: SeededRng;
let playerPile!: TavernPile;
let cpuPile!: TavernPile;
let fastForward = false;
let matchOver = false;

document.querySelectorAll<HTMLButtonElement>('.diff-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    difficulty = (btn.dataset.diff as AiDifficulty) ?? 'normal';
  });
});
document.querySelector('.diff-btn[data-diff="normal"]')?.classList.add('selected');

function paintHp(): void {
  hpPlayerEl.textContent = String(playerHp);
  hpCpuEl.textContent = String(cpuHp);
  roundEl.textContent = String(round);
}

function paintHud(): void {
  const snap = board.snapshot;
  phaseEl.textContent = snap.phase;
  linksEl.textContent = snap.linksLabel;
  const building = snap.phase === 'building' && !busy && !matchOver;
  btnClear.disabled = !building || snap.playCount === 0;
  btnCommit.disabled = !building || snap.playCount < 1;
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

async function discardTurnCards(): Promise<void> {
  const played = board.getPlayCards();
  const hand = board.getHandCards();
  playerPile.discardCards([...played, ...hand]);
  board.clear();
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
  resultEl.classList.remove('hidden');
  resultTitle.textContent = winner === 'player' ? 'Victory' : 'Defeat';
  resultDetail.textContent = `Round ${round} · You ${playerHp} — CPU ${cpuHp} · Seed ${matchSeed}`;
}

async function applyAttackDamage(defenderIsCpu: boolean, hops: number, recoil: boolean): Promise<void> {
  if (defenderIsCpu) cpuHp = Math.max(0, cpuHp - hops);
  else playerHp = Math.max(0, playerHp - hops);
  if (recoil) {
    if (defenderIsCpu) playerHp = Math.max(0, playerHp - 1);
    else cpuHp = Math.max(0, cpuHp - 1);
  }
  paintHp();
}

async function resolvePlayerAttack(): Promise<void> {
  busy = true;
  btnFast.classList.add('hidden');
  paintHud();
  const links = evaluateLinks(board.getPlayCards());
  const breakAt = firstBreakIndex(links);
  const recoil = breakAt >= 0;
  await board.resolve({
    damageMode: 'hops',
    onRecoil: () => {
      /* HP applied after resolve animation */
    },
  });
  const hops = hopDamageFromLinks(links);
  await applyAttackDamage(true, hops, recoil);
  await discardTurnCards();
  busy = false;
  await runCpuTurn();
}

async function runCpuTurn(): Promise<void> {
  const humanWasKo = cpuHp <= 0 && playerHp > 0;
  turnBanner.textContent = humanWasKo ? "CPU's final swing" : 'CPU attack';
  btnFast.classList.remove('hidden');

  board.setHandFaceDown(true);
  board.setInteractionAllowed(false);
  const hand = cpuPile.drawHand(5);
  board.dealToHand(hand);
  paintHud();

  await wait(400);
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

  await wait(fastForward ? 120 : 350);
  busy = true;
  const links = evaluateLinks(board.getPlayCards());
  const breakAt = firstBreakIndex(links);
  const recoil = breakAt >= 0;
  await board.resolve({
    damageMode: 'hops',
    onRecoil: () => {},
  });
  const hops = hopDamageFromLinks(links);
  await applyAttackDamage(false, hops, recoil);
  cpuPile.discardCards([...board.getPlayCards(), ...board.getHandCards()]);
  board.clear();
  board.setHandFaceDown(false);
  board.setInteractionAllowed(true);
  btnFast.classList.add('hidden');
  busy = false;

  const end = roundEndVerdict();
  if (end === 'player' || end === 'cpu') {
    showResult(end);
    return;
  }
  if (end === 'overtime') {
    turnBanner.textContent = 'Overtime — tied at KO';
    await wait(600);
  }

  round += 1;
  await startPlayerTurn();
}

async function startPlayerTurn(): Promise<void> {
  turnBanner.textContent = 'Your attack';
  const hand = playerPile.drawHand(5);
  board.dealToHand(hand);
  paintHp();
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
  matchOver = false;
  fastForward = false;
  setupEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  liveEl.classList.remove('hidden');
  paintHp();
  await startPlayerTurn();
}

btnStart.addEventListener('click', () => void startMatch());
btnRematch.addEventListener('click', () => {
  resultEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
});
btnClear.addEventListener('click', () => {
  if (busy || matchOver) return;
  board.clearPlayLine();
  paintHud();
});
btnCommit.addEventListener('click', () => void resolvePlayerAttack());
btnFast.addEventListener('click', () => {
  fastForward = true;
});

board = await GameBoard.create(boardHost);
board.setChangeListener(() => paintHud());
paintHud();
