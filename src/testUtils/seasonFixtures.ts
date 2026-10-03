import { pickBest22, type MatchTeam } from "../engine/team";
import { initSeason, simulateRound, nextUnplayedRound, type Season } from "../engine/season";
import { makePlayer } from "./makePlayer";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";

/**
 * Shared fixtures for the season test files (season.test.ts, seasonPlans.test.ts,
 * seasonCondition.test.ts). A synthetic 18-club league that deliberately doesn't touch the real
 * generated player data (src/data/generated/players.json), the same isolation match.test.ts uses.
 *
 * Oct 2026 test-suite performance pass: a full season is ~207 matches, and the season tests used to
 * re-simulate one per test, about 1,850 matches in total. `memo` lets every test in a file that
 * asserts on the same played-out season share one simulation. A season is immutable here
 * (`simulateRound`/`runFinals` return new objects, and matches play on their own copies of the teams),
 * so sharing can't leak state between tests.
 */
export const CLUB_IDS = Array.from({ length: 18 }, (_, i) => i + 1);

export function makeClubPool(seed: number): Player[] {
  const archetypes: Archetype[] = [
    "Key Defender",
    "Medium Defender",
    "Intercept Defender",
    "Half Back Flanker",
    "Back Pocket",
    "Inside Mid",
    "Outside Mid",
    "Key Forward",
    "Medium Forward",
    "Small Forward",
    "Pressure Forward",
    "Hybrid Mid Forward",
    "Ruck",
    "Hybrid Key Forward Ruck",
  ];
  const players: Player[] = [];
  for (let i = 0; i < 30; i++) {
    players.push(
      makePlayer({
        PlayerID: seed * 1000 + i,
        Team: `Club${seed}`,
        fname: `P${i}`,
        lname: `Club${seed}`,
        jumperNumber: i + 1,
        archetype: archetypes[i % archetypes.length],
        OVR: 50 + ((i * 7 + seed) % 40),
      }),
    );
  }
  return players;
}

export function buildTestTeams(): Map<number, MatchTeam> {
  const map = new Map<number, MatchTeam>();
  for (const id of CLUB_IDS) map.set(id, pickBest22(`Club${id}`, makeClubPool(id)));
  return map;
}

/** Plays `seed`'s season through `rounds` home-and-away rounds (all of them if omitted). */
export function playRounds(seed: number, teams: Map<number, MatchTeam>, rounds?: number): Season {
  let season = initSeason(seed, CLUB_IDS);
  let round = nextUnplayedRound(season);
  while (round !== null && (rounds === undefined || round <= rounds)) {
    season = simulateRound(season, round, teams);
    round = nextUnplayedRound(season);
  }
  return season;
}

/** Computes `make()` once, on first use, then returns the same value. Lazy, so a filtered run (`-t`) only pays for what it uses. */
export function memo<T>(make: () => T): () => T {
  let value: { v: T } | null = null;
  return () => (value ??= { v: make() }).v;
}
