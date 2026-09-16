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
import { STADIUM_CONFIGS, type AFLStadium } from "./stadiums.ts";

/**
 * Each of the 18 real clubs' actual primary home ground, mapped onto
 * `data/stadiums.ts`'s `STADIUM_CONFIGS` table — straight from
 * [[Club Database]]'s own `Home ground:` field (see the design note's own
 * 18-club cross-check table). Keys are `ClubID` (matches `types/club.ts`'s
 * `CLUBS`/`Player.ClubID`/`Player Database/Schema.md`), not club name, since
 * that's what `FixtureMatch.homeClubId` actually carries.
 *
 * 16 of 18 clubs already had a configured ground as of round 12 (multi-
 * tenant sharing working exactly as expected: 4 clubs on the MCG, 5 on
 * Marvel, 2 each on Adelaide Oval and Optus). GWS and Gold Coast were the
 * one real gap round 13 found — round 11's original 7-ground list was
 * scoped to "iconic" grounds for visual variety, not full 18-club coverage
 * — filled with `engie`/`peopleFirst` (round 14).
 *
 * Sep 2026 round 104: repointed onto `data/stadiums.ts`'s 20-venue ids
 * (`data/grounds.ts`, the old 12-venue table, is deleted this round) — a
 * clean 1:1 id migration, every club's actual real-world venue unchanged:
 * `adelaideOval->adelaide_oval, optus->optus_stadium,
 * kardiniaPark->kardinia_park, peopleFirst->carrara, engie->engie_stadium`
 * (the other 7 old ids — mcg, gabba, marvel, scg — already matched the new
 * table's own ids verbatim). See [[Venue-Accurate Ground Renderer]] for the
 * full 12-of-20 mapping and why the other 8 report venues aren't attached to
 * any club here.
 */
export const CLUB_PRIMARY_GROUND: Record<number, string> = {
  1: "adelaide_oval", // Adelaide
  2: "gabba", // Brisbane Lions
  3: "marvel", // Carlton
  4: "mcg", // Collingwood
  5: "marvel", // Essendon
  6: "optus_stadium", // Fremantle
  7: "kardinia_park", // Geelong
  8: "carrara", // Gold Coast
  9: "engie_stadium", // Greater Western Sydney
  10: "mcg", // Hawthorn
  11: "mcg", // Melbourne
  12: "marvel", // North Melbourne
  13: "adelaide_oval", // Port Adelaide
  14: "mcg", // Richmond
  15: "marvel", // St Kilda
  16: "scg", // Sydney
  17: "optus_stadium", // West Coast
  18: "marvel", // Western Bulldogs
};

/**
 * The confirmed away-designated-home-game exceptions from round 13's real
 * 2026 AFL fixture research — Hawthorn/Tasmania, Gold Coast/Darwin, GWS/
 * Manuka, exactly the three Tyler named as examples ("etc"). `groundId`
 * points at `data/stadiums.ts`'s `york_park`/`marrara_oval`/`manuka_oval`
 * entries (round 104 ids — round 14's original `tasmania`/`tio`/`manuka`
 * ids, before the venue-accurate rebuild).
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
  { clubId: 10, groundId: "york_park", homeGamesPerSeason: 3, label: "Hawthorn — Tasmania (University of Tasmania Stadium, Launceston)" },
  { clubId: 8, groundId: "marrara_oval", homeGamesPerSeason: 2, label: "Gold Coast — Darwin (TIO Stadium)" },
  { clubId: 9, groundId: "manuka_oval", homeGamesPerSeason: 1, label: "Greater Western Sydney — Manuka (Manuka Oval, Canberra)" },
];

/**
 * Which `AFLStadium` a given match should actually use — the one real
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
export function groundForMatch(homeClubId: number, round?: number, fixture?: FixtureMatch[]): AFLStadium {
  const primaryId = CLUB_PRIMARY_GROUND[homeClubId];
  const primary = primaryId ? STADIUM_CONFIGS[primaryId] : STADIUM_CONFIGS["mcg"];

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

  return exceptionRounds.has(round) ? STADIUM_CONFIGS[exception.groundId] : primary;
}
