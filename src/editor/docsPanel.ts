/** In-editor docs distilled from store docs/effect-dsl.md (Lua + fx v0). */

export const EFFECT_DOCS_HTML = `
<h3>Start here</h3>
<p class="docs-note">
  Prefer <strong>sugar helpers</strong>:
  <code>fx.my_slot()</code>, <code>fx.line_cards()</code>, <code>fx.add_to_me(n)</code>,
  <code>fx.deal_to_enemy(n)</code>, <code>fx.block_me(n)</code>.
  Dense <code>fx.self.*</code> paths still work.
  <a href="/editor-docs.html">Tutorials →</a>
</p>
<ul>
  <li><code>on_score(fx)</code> — <strong>SCORE</strong>, after hop/streak, slot ascending. Most starters.</li>
  <li><code>on_clash(fx)</code> — <strong>CLASH</strong>, after both SCORE. Shield-style blocks only.</li>
</ul>

<h3>Sugar vs dense</h3>
<pre class="docs-pre">-- dense
local line, i = fx.self.line, fx.self.slot
fx.add(fx.self, 100, "effect")

-- clearer (same power)
local i = fx.my_slot()
local L = fx.line_cards()
fx.add_to_me(100)</pre>

<h3>Example — Thunderer</h3>
<pre class="docs-pre">function on_score(fx)
  local i = fx.my_slot()
  local L = fx.line_cards()
  -- …check neighbors for S K S…
  fx.add_to_me(100)
end</pre>
<p class="docs-note">Neighbor windows still need Lua indexing — see the tutorials page.</p>

<h3>fx allow-list</h3>
<pre class="docs-pre">-- sugar (prefer these)
fx.my_line / fx.my_slot / fx.my_card
fx.line_cards / fx.my_chain / fx.empty_slots
fx.enemy_at_my_slot
fx.add_to_me / fx.deal_to_enemy / fx.block_me

-- full power
fx.self / fx.enemy
fx.outgoing(card, opts?)
fx.slot / fx.hand / fx.unplayed
fx.add / fx.deal / fx.block_slot</pre>

<h3>Five starters</h3>
<ul>
  <li><strong>Thunderer</strong> — +100 in an S→K→S triple</li>
  <li><strong>Shield</strong> — block half of enemy same-slot outgoing</li>
  <li><strong>Golem</strong> — +50 per G in <code>fx.my_chain()</code></li>
  <li><strong>Sprinter</strong> — +30 per K/S on <code>fx.line_cards()</code></li>
  <li><strong>Burnt Offering</strong> — 100× <code>fx.empty_slots()</code> via <code>deal_to_enemy</code></li>
</ul>
<p class="docs-note">Ctrl+Space autocomplete. F11 / Fullscreen for the editor. Hover <code>fx</code> for docs.</p>
`;

export function mountDocsPanel(host: HTMLElement): void {
  host.innerHTML = EFFECT_DOCS_HTML;
}
