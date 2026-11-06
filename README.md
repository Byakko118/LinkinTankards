# Linkin' Tankards — gameplay loop prototype

Rough PixiJS board: deal a hand of 5, **build the play line yourself**, watch chain travel stop at broken links, resolve prefix damage.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

- **Attack tester gallery:** http://localhost:5173/tester.html — speed select, *Freeze on contact*, *Play all*; URL `?speed=0.25&freeze=20` presets them
- Hand-building UI: http://localhost:5173/?demo=hand
- Valid full chain (G→K→A→S→G): http://localhost:5173/?demo=1
- Keep attacks (G→G + A→A): http://localhost:5173/?demo=keeps
- Lane ping-pong (G→K→S→K→A): http://localhost:5173/?demo=rebound
- Illegal G→A break: http://localhost:5173/?demo=break
- Auto-resolve: add `&auto=resolve`
- Attack slow-mo: add `&slow=0.25` · freeze N ms after a hop's contact: `&freeze=20` (`&freezeSkip=2` lets the first two hops play through)

Contact screenshots: `node scripts/capture-contact.mjs` (tester), `node scripts/capture-gameplay-contact.mjs` (board), `node scripts/capture-filmstrip.mjs` (slow-mo strips); set `MEDIA_DIR` for the output folder.

## How to play

1. **Deal 5** — cards land in the **hand** strip (not on the table).
2. **Click a hand card** to append it to the play line.
3. **Click a played card** to return it *and everything after it* to hand.
4. **Clear line** dumps the whole play line back to hand.
5. **Resolve** when the line has **≥1 card**. Travel FX stops at the first illegal link; damage = valid prefix only.
6. **Next turn** deals a fresh hand.

## Directed connections

Lane after each card decides what may come next:

| After | Lane | Next allowed |
|-------|------|--------------|
| G Ground | ground | G, K |
| K Knockup | air | A, S |
| A Air | air | A, S |
| S Slam | ground | G, K |

- **K** = ground→air changer · **S** = air→ground changer
- **G** / **A** = keepers (stay in-lane)
- Invalid examples: **G→A**, **A→G**, G→S, A→K, K→G, S→A, …

## Visual tweak knobs

- Layout / FX: `src/game/board.ts`
- Hop attack recipes (contact solver, impact, hit-stop): `src/game/attacks.ts`
- Rules / damage / colors: `src/game/rules.ts`
- Page chrome: `src/style.css`, `index.html`
