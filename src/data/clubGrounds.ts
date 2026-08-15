/**
 * Fixture-driven ground selection — Aug 2026, Phase 10 round 14. Tyler:
 * "The ground selection will be based upon AFL Fixtures... The fixture will
 * determine the home team and that home team will primarily use their real
 * home ground with a few exceptions for Tasmania games, Darwin games,
 * Manuka games etc," then "Build just the smaller scope fixture" —
 * greenlighting "Layer A" from the vault's "Ground Selection - Fixture-
 * Driven Home Grounds" design note (round 13's research), not "Layer B"
 * (replacing `engine/fixture.ts`'s round-robin draw with the AFL's real
 * ladder-weighted/rivalry-biased one — a separate, bigger, unrequested
 * feature, deliberately left alone here).
 *
 * This file is the whole of Layer A: which `GroundConfig` (src/data/
 * grounds.ts) a club's home matches use, by default and for the confirmed
 * real exceptions. `src/engine/fixture.ts`'s `FixtureMatch.homeClubId`
 * already exists and needed no changes at all — this attaches to it, it
 * doesn't touch it.
 */
import type { FixtureMatch } from "../engine/fixture.ts";
import { GROUND_CONFIGS, type GroundConfig } from "./grounds.ts";

/**
 * Each of the 18 real clubs' actual primary home ground, mapped onto
 * grounds.ts's `GROUND_CONFIGS` table — straight from [[Club Database]]'s
 * own `Home ground:` field (see the design note's own 18-club cross-check
 * table). Keys are `ClubID` (matches `types/club.ts`'s `CLUBS`/
 * `Player.ClubID`/`Player Database/Schema.md`), not club name, since that's
 * what `FixtureMatch.homeClubId` actually carries.
 *
 * 16 of 18 clubs already had a configured ground as of round 12 (multi-
 * tenant sharing working exactly as expected: 4 clubs on the MCG, 5 on
 * Marvel, 2 each on Adelaide Oval and Optus). GWS and Gold Coast were the
 * one real gap round 13 found — round 11's original 7-ground list was
 * scoped to "iconic" grounds for visual variety, not full 18-club coverage
 * — filled here with `engie`/`peopleFirst` (grounds.ts, round 14).
 */
export const CLUB_PRIMARY_GROUND: Record<number, string> = {
  1: "adelaideOval", // Adelaide
  2: "gabba", // Brisbane Lions
  3: "marvel", // Carlton
  4: "mcg", // Collingwood
  5: "marvel", // Essendon
  6: "optus", // Fremantle
  7: "kardiniaPark", // Geelong
  8: "peopleFirst", // Gold Coast
  9: "engie", // Greater Western Sydney
  10: "mcg", // Hawthorn
  11: "mcg", // Melbourne
  12: "marvel", // North Melbourne
  13: "adelaideOval", // Port Adelaide
  14: "mcg", // Richmond
  15: "marvel", // St Kilda
  16: "scg", // Sydney
  17: "optus", // West Coast
  18: "marvel", // Western Bulldogs
};

/**
 * The confirmed away-designated-home-game exceptions from round 13's real
 * 2026 AFL fixture research — Hawthorn/Tasmania, Gold Coast/Darwin, GWS/
 * Manuka, exactly the three Tyler named as examples ("etc"). `groundId`
 * points at grounds.ts's round-14-added `tasmania`/`tio`/`manuka` entries,
 * built the same tomgorey.com-sourced, compression-mapped way as every
 * other ground in that table.
 *
 * `homeGamesPerSeason` is how many of that club's home rounds each season
 * use the exception ground rather than their primary one:
 * - Hawthorn/Tasmania: 3 — directly confirmed in the fetched 2026 fixture
 *   (their home games vs. Gold Coast, Melbourne, and North Melbourne were
 *   all played at University of Tasmania Stadium).
 * - Gold Coast/Darwin: 2 — confirmed by TIO Stadium's own Wikipedia page
 *   ("From 2020, Gold Coast Suns will play two home games a year at
 *   Marrara Oval").
 * - GWS/Manuka: 1 — the fetched fixture confirmed the arrangement exists
 *   but not a specific per-season count; 1 is a conservative default, not
 *   a sourced figure the other two are — worth revisiting if a firmer
 *   count turns up.
 *
 * See `groundForMatch`'s own doc comment for how this count is actually
 * turned into "which round(s)" — a deliberate, disclosed approximation
 * (Layer B — modelling the real calendar/broadcast placement — is out of
 * scope this round, see the design note).
 */
export interface GroundException {
  clubId: number;
  groundId: string;
  homeGamesPerSeason: number;
  label: string;
}

export const GROUND_EXCEPTIONS: GroundException[] = [
  { clubId: 10, groundId: "tasmania", homeGamesPerSeason: 3, label: "Hawthorn — Tasmania (University of Tasmania Stadium, Launceston)" },
  { clubId: 8, groundId: "tio", homeGamesPerSeason: 2, label: "Gold Coast — Darwin (TIO Stadium)" },
  { clubId: 9, groundId: "manuka", homeGamesPerSeason: 1, label: "Greater Western Sydney — Manuka (Manuka Oval, Canberra)" },
];

/**
 * Which `GroundConfig` a given match should actually use — the one real
 * lookup this whole file exists to provide. Falls back to the home club's
 * primary ground whenever an exception doesn't apply, which is every match
 * for 15 of 18 clubs and most of a season for the other 3, matching Tyler's
 * own framing exactly ("primarily use their real home ground with a few
 * exceptions").
 *
 * `round`/`fixture` are both optional: omit either one and this always
 * returns the primary ground, never a guessed exception. That's a
 * deliberate, honest default, not a missing feature — `LiveMatch.tsx`'s
 * ad-hoc "pick any two clubs" friendly screen has no fixture/round concept
 * at all (its own copy: "The match runs against a fresh random seed every
 * time"), so it has no principled way to decide *which* of a club's home
 * games this is. Defaulting to "primarily use their real home ground" is
 * more defensible than picking an exception arbitrarily — and is still
 * true of the large majority of even an exception club's own home games.
 *
 * When both are supplied (e.g. a future season/live-match hookup — gap #19
 * in Status.md, not built yet, this is deliberately "ready for whatever
 * eventually consumes it" per the design note), the exception round(s) are
 * chosen deterministically: evenly spaced across that club's real home
 * rounds for the season, not randomly and not clustered at the start/end,
 * so a given fixture always produces the same answer (this project's
 * standing "no Math.random outside an explicit seed" discipline — see
 * fixture.ts's own doc comment) — without pretending to model the real
 * AFL's actual broadcast/travel-driven placement (Layer B, explicitly not
 * built this round).
 */
export function groundForMatch(homeClubId: number, round?: number, fixture?: FixtureMatch[]): GroundConfig {
  const primaryId = CLUB_PRIMARY_GROUND[homeClubId];
  const primary = primaryId ? GROUND_CONFIGS[primaryId] : GROUND_CONFIGS[GROUND_CONFIGS["mcg"].id];

  if (round === undefined || !fixture) return primary;

  const exception = GROUND_EXCEPTIONS.find((e) => e.clubId === homeClubId);
  if (!exception) return primary;

  const homeRounds = fixture
    .filter((m) => m.homeClubId === homeClubId)
    .map((m) => m.round)
    .sort((a, b) => a - b);
  const count = Math.min(exception.homeGamesPerSeason, homeRounds.length);
  if (count <= 0) return primary;

  // Evenly spaced indices into this club's own home rounds - e.g. 3 of 12
  // home rounds picks indices 0, 4, 8 rather than the first 3 (all bunched
  // early) or a random 3 (not reproducible - see doc comment above).
  const exceptionRounds = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i * homeRounds.length) / count);
    exceptionRounds.add(homeRounds[idx]);
  }

  return exceptionRounds.has(round) ? GROUND_CONFIGS[exception.groundId] : primary;
}
