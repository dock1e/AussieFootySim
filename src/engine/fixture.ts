/**
 * Home-and-away fixture generation — Configuration.md "Season structure":
 * "23 home-and-away rounds + top-8 finals, matching the current real AFL
 * season shape." No exact draw algorithm is specified in the vault (the real
 * AFL draw is rivalry/travel-weighted and hand-tuned by the league each
 * year), so this is a deliberate, documented simplification:
 *
 * 1. Standard circle-method round robin across all 18 clubs produces 17
 *    rounds where every club plays every other club exactly once.
 * 2. To reach 23 rounds, rounds 1-6 are replayed with home/away reversed —
 *    i.e. 6 of the 17 opponents are played twice (home and away), the
 *    other 11 only once. This mirrors the real AFL draw's actual shape
 *    (each club plays ~6 opponents twice, ~11 once) even though *which*
 *    opponents get doubled up here is a by-product of round-robin order,
 *    not rivalry/interstate-travel weighting like the real draw.
 *
 * Deterministic given the same `clubIds` order — no RNG involved, since a
 * fixture draw isn't naturally a "random per playthrough" thing the way
 * match outcomes are.
 */

export const SEASON_ROUNDS = 23;

export interface FixtureMatch {
  round: number; // 1-based, 1..SEASON_ROUNDS
  homeClubId: number;
  awayClubId: number;
}

/** Standard circle-method round robin: fix the first club, rotate the rest each round. Returns n-1 rounds for n clubs, each club appearing exactly once per round. */
function circleMethodRounds(clubIds: number[]): [number, number][][] {
  const n = clubIds.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(`circleMethodRounds requires an even number of clubs >= 2, got ${n}`);
  }
  const fixed = clubIds[0];
  let rotating = clubIds.slice(1);
  const rounds: [number, number][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const arranged = [fixed, ...rotating];
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arranged[i];
      const b = arranged[n - 1 - i];
      // Stagger which side of the pair counts as "home" by round+pair index,
      // rather than the same slot always being home — a cheap way to avoid
      // e.g. `arranged[0]` (the fixed club) being home every single round.
      const aIsHome = (r + i) % 2 === 0;
      pairs.push(aIsHome ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
  }

  return rounds;
}

/** Generates the full SEASON_ROUNDS-round home-and-away fixture for a set of clubs (must be even in number). */
export function generateFixture(clubIds: number[]): FixtureMatch[] {
  const baseRounds = circleMethodRounds(clubIds);
  if (baseRounds.length > SEASON_ROUNDS) {
    throw new Error(
      `generateFixture: round-robin needs ${baseRounds.length} rounds, more than SEASON_ROUNDS=${SEASON_ROUNDS}`,
    );
  }

  const matches: FixtureMatch[] = [];
  baseRounds.forEach((pairs, i) => {
    const round = i + 1;
    for (const [home, away] of pairs) matches.push({ round, homeClubId: home, awayClubId: away });
  });

  const extraRoundsNeeded = SEASON_ROUNDS - baseRounds.length;
  for (let i = 0; i < extraRoundsNeeded; i++) {
    const pairs = baseRounds[i % baseRounds.length];
    const round = baseRounds.length + i + 1;
    // Reversed home/away vs. the original meeting.
    for (const [home, away] of pairs) matches.push({ round, homeClubId: away, awayClubId: home });
  }

  return matches.sort((a, b) => a.round - b.round);
}

export function matchesInRound(fixture: FixtureMatch[], round: number): FixtureMatch[] {
  return fixture.filter((m) => m.round === round);
}

export function roundsForClub(fixture: FixtureMatch[], clubId: number): FixtureMatch[] {
  return fixture
    .filter((m) => m.homeClubId === clubId || m.awayClubId === clubId)
    .sort((a, b) => a.round - b.round);
}
