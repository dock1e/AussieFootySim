/**
 * Oct 2026 — [[Injuries]]. Real players Tyler named as prone, by PlayerID (see `engine/injury.ts`).
 * A player's own `softTissueProne`/`concussionProne` field, when set, overrides these lists.
 */

/** Recurring hamstring/calf trouble. */
export const SOFT_TISSUE_PRONE_IDS: ReadonlySet<number> = new Set([
  1749, // Elliot Yeo (West Coast) — recurring calf and hamstring strains
  1248, // Jack Martin (Geelong) — chronic hamstring setbacks
  1168, // Jordan Ridley (Essendon) — calf and hamstring strains
  1127, // Darcy Moore (Collingwood) — career-long hamstring vulnerability
  1648, // Sam Darcy (Western Bulldogs) — minor soft-tissue interruptions
]);

/** Multiple stints in concussion protocols. */
export const CONCUSSION_PRONE_IDS: ReadonlySet<number> = new Set([
  1534, // Mitch Owens (St Kilda)
  1481, // Tim Taranto (Richmond)
  1343, // Harry Morrison (Hawthorn)
  1636, // Matt Kennedy (Western Bulldogs)
  1365, // Christian Petracca (Gold Coast in the current player data)
]);
