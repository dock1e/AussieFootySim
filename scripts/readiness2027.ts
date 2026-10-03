/**
 * `npm run readiness:2027` — is the real 2026 off-season fully entered, so new games can start in 2027?
 * Prints every item from `engine/seasonStart.ts`'s `seasonStartReadiness` plus the per-club list sizes
 * a 2027 start would produce. Exits non-zero while any REQUIRED item is outstanding, so it can gate the
 * `RELEASE_START_SEASON` flip in `src/config.ts`.
 */
import { generatedPlayers } from "../src/data/loadPlayers.ts";
import { buildStartingPlayers, seasonStartReadiness } from "../src/engine/seasonStart.ts";
import { OFF_SEASON_2026_PROGRESS } from "../src/data/realOffSeason2026.ts";
import { RELEASE_START_SEASON } from "../src/config.ts";

const base = generatedPlayers();
const items = seasonStartReadiness(base, 2027);
console.log(`2027 season start readiness (off-season log last updated ${OFF_SEASON_2026_PROGRESS.lastUpdated}; shipping start season: ${RELEASE_START_SEASON})\n`);
for (const item of items) {
  console.log(`${item.ready ? "[x]" : "[ ]"} ${item.label}${item.required ? "" : " (optional)"}\n    ${item.detail}`);
}
const { report } = buildStartingPlayers(base, 2027);
console.log("\nList sizes a 2027 start would produce:");
console.log(Object.entries(report.listSizes).map(([club, n]) => `  ${club.padEnd(24)} ${n}`).join("\n"));
const outstanding = items.filter((i) => i.required && !i.ready);
console.log(outstanding.length ? `\nNot ready: ${outstanding.length} required item(s) outstanding.` : "\nReady: flip RELEASE_START_SEASON to 2027 in src/config.ts.");
process.exitCode = outstanding.length ? 1 : 0;
