/**
 * ROADMAP #11 / gap #76 verify script — free-kick volume by type, plus the headline stats the new
 * free-kick types must NOT move (they only relabel an existing possession change). Full 153-match
 * round-robin across the 18 real clubs. Run before and after; compare.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = [
  "Adelaide", "Brisbane Lions", "Carlton", "Collingwood", "Essendon",
  "Fremantle", "Geelong", "Gold Coast", "Greater Western Sydney", "Hawthorn",
  "Melbourne", "North Melbourne", "Port Adelaide", "Richmond", "St Kilda",
  "Sydney", "West Coast", "Western Bulldogs",
];
const BASE_SEED = 1100001;
const totals: Record<string, number> = {};
const kinds: Record<string, number> = {};
let matches = 0;
let goals = 0;
const playersByClub = new Map(CLUBS.map((c) => [c, getPlayersByClub(c)]));
for (let i = 0; i < CLUBS.length; i++) {
  for (let j = i + 1; j < CLUBS.length; j++) {
    const hp = playersByClub.get(CLUBS[i])!;
    const ap = playersByClub.get(CLUBS[j])!;
    const seed = BASE_SEED + matches;
    const r = simulateMatch(lineupToMatchTeam(CLUBS[i], autoFillLineup(hp), hp), lineupToMatchTeam(CLUBS[j], autoFillLineup(ap), ap), mulberry32(seed), seed, {});
    for (const line of Object.values(r.boxScore)) {
      for (const k of ["freeKicksFor", "freeKicksAgainst", "tackles", "turnovers", "marks", "disposals", "kicks", "clangers", "shotsAtGoal"] as const) {
        totals[k] = (totals[k] ?? 0) + (line[k] ?? 0);
      }
    }
    for (const ev of r.events) {
      const fk = (ev as { freeKick?: { kind: string } }).freeKick;
      if (fk) kinds[fk.kind] = (kinds[fk.kind] ?? 0) + 1;
    }
    goals += r.home.goals + r.away.goals;
    matches++;
  }
}
const perTeam = (n: number) => (n / (matches * 2)).toFixed(2);
console.log(`${matches} matches`);
for (const [k, v] of Object.entries(totals)) console.log(`${k}: ${perTeam(v)}/team/match`);
console.log(`goals: ${perTeam(goals)}/team/match`);
for (const [k, v] of Object.entries(kinds)) console.log(`freeKick.${k}: ${perTeam(v)}/team/match`);
