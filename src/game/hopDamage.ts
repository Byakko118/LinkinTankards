import { LinkInfo, chainLength } from './rules';

/** PvC combat: 1 HP per valid hop (link), not per-card printed damage. */
export function hopDamageFromLinks(links: readonly LinkInfo[]): number {
  return chainLength(links);
}
