/** In-editor docs distilled from store docs/effect-dsl.md (Lua + fx v0). */

export const EFFECT_DOCS_HTML = `
<h3>Hooks</h3>
<ul>
  <li><code>on_score(fx)</code> — after hop/streak attributed; per slot ascending. Writes: <code>fx.add</code>, <code>fx.deal</code>.</li>
  <li><code>on_clash(fx)</code> — after both SCORE passes; mirrored slots. Writes: <code>fx.block_slot</code>. Reads frozen <code>fx.outgoing</code>.</li>
</ul>
<p class="docs-note">BUILD never runs scripts (no spoilers). Failed scripts no-op that card and continue.</p>

<h3>fx allow-list</h3>
<pre class="docs-pre">-- reads
fx.self / fx.enemy
fx.outgoing(card, opts?)
fx.slot(side, i)
fx.hand(side) / fx.unplayed(side)
fx.draw_count / fx.discard_count
fx.draw_cards / fx.discard_cards

-- SCORE writes
fx.add(card, amount, "effect")
fx.deal(target_hp, amount, "effect", source)

-- CLASH writes
fx.block_slot(slot, amount)</pre>
<p class="docs-note">Own unplayed/draw/discard <strong>faces</strong> OK at resolve; enemy <strong>counts</strong> only unless reveal. Indices 1-based. Damage ×100.</p>

<h3>ResolveView (Side)</h3>
<ul>
  <li><code>.line</code> — .cards .capacity .empty .links .break_at</li>
  <li><code>.hand</code> — .unplayed .played + counts</li>
  <li><code>.draw</code> / <code>.discard</code> — .count .cards?</li>
  <li><code>.slot</code> / <code>.chain</code> — pulse context for current card</li>
</ul>

<h3>Five starters</h3>
<ul>
  <li><strong>Thunderer</strong> — SCORE: +100 if in an S→K→S triple</li>
  <li><strong>Shield</strong> — CLASH: block half of enemy same-slot outgoing</li>
  <li><strong>Golem</strong> — SCORE: +50 per G in <code>fx.self.chain</code></li>
  <li><strong>Sprinter</strong> — SCORE: +30 per K/S on full played line</li>
  <li><strong>Burnt Offering</strong> — SCORE: 100× empty line slots via <code>fx.deal</code> to enemy HP</li>
</ul>
<p class="docs-note">Ctrl+Space for autocomplete. Hover <code>fx</code> symbols for docs.</p>
`;

export function mountDocsPanel(host: HTMLElement): void {
  host.innerHTML = EFFECT_DOCS_HTML;
}
