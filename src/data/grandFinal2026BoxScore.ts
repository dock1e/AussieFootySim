/**
 * Round C145 — [[End-of-2026 Player Database Refresh]] / [[AFL Archetype and Role Fluidity - Scoping
 * Note]]'s Round C145 addendum. Grand Final box-score ingestion, deliberately scoped small.
 *
 * **Why this exists as its own file rather than an extension of `grandFinal2026.ts`**: a grep of
 * `app/src/data/` and `app/src/types/` before this round found no existing "real match log" /
 * "real match history" / box-score mechanism anywhere in this codebase — `grandFinal2026.ts` (round
 * 128) only ever held the pre-match verified 22-man team lists for lineup-selection purposes, never
 * a per-player stat line. Building a genuine real-match-log architecture (multi-quarter scoring
 * progression, a `RealMatch`/`MatchBoxScore` type usable for future real rounds, engine wiring) is
 * real, separate scope this round explicitly does not take on — see the design note's own steer
 * against inventing a full match-simulation-log architecture from a single box score. This file is
 * the deliberately minimal, disclosed alternative: just enough real signal (disposals, goals, and
 * the one real, known Norm Smith result) to support a scouting-text/Player-Career "big game"
 * callout, joinable against the existing roster by `realFullName`.
 *
 * **Source**: afltables.com's own match-stats page
 * (`https://afltables.com/afl/stats/games/2026/081920260926.html`), fetched live this round — the
 * full, real per-player box score for the 2026 AFL Grand Final (Brisbane Lions defeated Fremantle,
 * 14.12.96 to 12.17.89, M.C.G., attendance 100,023, Sat 26 Sep 2026, coaches Chris Fagan / Justin
 * Longmuir). This is Brisbane's third consecutive premiership. Every one of the 23-a-side names
 * below matches, one-for-one, the verified pre-match lineups already captured in `grandFinal2026.ts`
 * (round 128) — no additional players, no substitutes were used in the real game (afltables' own
 * "Rushed" pseudo-rows, not player rows, are the only other entries on the source page).
 *
 * **What's deliberately NOT carried over from the source page** (disclosed, not silently dropped):
 * every other real column afltables records (kicks, marks, handballs, tackles, clearances,
 * hit-outs, contested/uncontested possessions, etc.), the full quarter-by-quarter scoring
 * progression, and disposal-average/percentage-of-game-played splits. Only `disposals` and `goals`
 * are carried in, per the design note's own "just enough real box-score signal to be useful for
 * scouting text or a Player Career 'big game' callout, NOT a full 23-column-per-player replica."
 *
 * **`normSmith` flag**: real, not judged — Shai Bolton (Fremantle) won the actual 2026 Norm Smith
 * Medal, on the losing side, per Tyler's own direct steer (see the design note's Round C141
 * addendum, and `realDraftHistory.ts`'s existing "Norm Smith: 2026" tag on both of Bolton's rows).
 * No other player here is marked `normSmith`/"best afield" — this file does not invent a subjective
 * best-afield judgment for anyone else; disposals/goals are left as the real, raw signal for anyone
 * reading this data to form their own view.
 */

export const GRAND_FINAL_2026_RESULT = {
  venue: "M.C.G.",
  date: "2026-09-26",
  attendance: 100023,
  Fremantle: { goals: 12, behinds: 17, points: 89 },
  "Brisbane Lions": { goals: 14, behinds: 12, points: 96 },
  winner: "Brisbane Lions",
  premiershipStreak: 3, // Brisbane's third consecutive flag (2024, 2025, 2026)
  coaches: { Fremantle: "Justin Longmuir", "Brisbane Lions": "Chris Fagan" },
  normSmithMedallist: "Shai Bolton",
} as const;

export interface GrandFinal2026PlayerLine {
  realFullName: string;
  club: "Fremantle" | "Brisbane Lions";
  disposals: number;
  goals: number;
  normSmith: boolean;
}

export const GRAND_FINAL_2026_BOX_SCORE: readonly GrandFinal2026PlayerLine[] = [
  // Fremantle (afltables order) — final score 12.17.89
  { realFullName: "Jye Amiss", club: "Fremantle", disposals: 10, goals: 2, normSmith: false },
  { realFullName: "Shai Bolton", club: "Fremantle", disposals: 26, goals: 0, normSmith: true },
  { realFullName: "Andrew Brayshaw", club: "Fremantle", disposals: 16, goals: 0, normSmith: false },
  { realFullName: "Heath Chapman", club: "Fremantle", disposals: 10, goals: 0, normSmith: false },
  { realFullName: "Jordan Clark", club: "Fremantle", disposals: 14, goals: 0, normSmith: false },
  { realFullName: "Mason Cox", club: "Fremantle", disposals: 2, goals: 0, normSmith: false },
  { realFullName: "Isaiah Dudley", club: "Fremantle", disposals: 13, goals: 2, normSmith: false },
  { realFullName: "Neil Erasmus", club: "Fremantle", disposals: 11, goals: 0, normSmith: false },
  { realFullName: "Michael Frederick", club: "Fremantle", disposals: 9, goals: 1, normSmith: false },
  { realFullName: "Luke Jackson", club: "Fremantle", disposals: 15, goals: 0, normSmith: false },
  { realFullName: "Matthew Johnson", club: "Fremantle", disposals: 16, goals: 0, normSmith: false },
  { realFullName: "Oscar McDonald", club: "Fremantle", disposals: 13, goals: 0, normSmith: false },
  { realFullName: "Judd McVee", club: "Fremantle", disposals: 10, goals: 0, normSmith: false },
  { realFullName: "Alex Pearce", club: "Fremantle", disposals: 2, goals: 0, normSmith: false },
  { realFullName: "Murphy Reid", club: "Fremantle", disposals: 21, goals: 1, normSmith: false },
  { realFullName: "Luke Ryan", club: "Fremantle", disposals: 13, goals: 0, normSmith: false },
  { realFullName: "Caleb Serong", club: "Fremantle", disposals: 24, goals: 0, normSmith: false },
  { realFullName: "Sam Switkowski", club: "Fremantle", disposals: 16, goals: 0, normSmith: false },
  { realFullName: "Josh Treacy", club: "Fremantle", disposals: 9, goals: 1, normSmith: false },
  { realFullName: "Patrick Voss", club: "Fremantle", disposals: 9, goals: 3, normSmith: false },
  { realFullName: "Corey Wagner", club: "Fremantle", disposals: 11, goals: 0, normSmith: false },
  { realFullName: "Karl Worner", club: "Fremantle", disposals: 16, goals: 0, normSmith: false },
  { realFullName: "Hayden Young", club: "Fremantle", disposals: 22, goals: 2, normSmith: false },

  // Brisbane Lions (afltables order) — final score 14.12.96, premiers
  { realFullName: "Oscar Allen", club: "Brisbane Lions", disposals: 9, goals: 2, normSmith: false },
  { realFullName: "Harris Andrews", club: "Brisbane Lions", disposals: 11, goals: 0, normSmith: false },
  { realFullName: "Levi Ashcroft", club: "Brisbane Lions", disposals: 19, goals: 1, normSmith: false },
  { realFullName: "Will Ashcroft", club: "Brisbane Lions", disposals: 31, goals: 0, normSmith: false },
  { realFullName: "Zac Bailey", club: "Brisbane Lions", disposals: 20, goals: 1, normSmith: false },
  { realFullName: "Jarrod Berry", club: "Brisbane Lions", disposals: 17, goals: 0, normSmith: false },
  { realFullName: "Charlie Cameron", club: "Brisbane Lions", disposals: 16, goals: 3, normSmith: false },
  { realFullName: "Sam Draper", club: "Brisbane Lions", disposals: 11, goals: 1, normSmith: false },
  { realFullName: "Josh Dunkley", club: "Brisbane Lions", disposals: 21, goals: 0, normSmith: false },
  { realFullName: "Jaspa Fletcher", club: "Brisbane Lions", disposals: 20, goals: 0, normSmith: false },
  { realFullName: "Darcy Fort", club: "Brisbane Lions", disposals: 8, goals: 0, normSmith: false },
  { realFullName: "Ty Gallop", club: "Brisbane Lions", disposals: 9, goals: 0, normSmith: false },
  { realFullName: "Darcy Gardiner", club: "Brisbane Lions", disposals: 7, goals: 0, normSmith: false },
  { realFullName: "Eric Hipwood", club: "Brisbane Lions", disposals: 6, goals: 0, normSmith: false },
  { realFullName: "Ryan Lester", club: "Brisbane Lions", disposals: 15, goals: 0, normSmith: false },
  { realFullName: "Kai Lohmann", club: "Brisbane Lions", disposals: 14, goals: 2, normSmith: false },
  { realFullName: "Hugh McCluggage", club: "Brisbane Lions", disposals: 18, goals: 0, normSmith: false },
  { realFullName: "Conor McKenna", club: "Brisbane Lions", disposals: 10, goals: 1, normSmith: false },
  { realFullName: "Logan Morris", club: "Brisbane Lions", disposals: 10, goals: 3, normSmith: false },
  { realFullName: "Lachie Neale", club: "Brisbane Lions", disposals: 20, goals: 0, normSmith: false },
  { realFullName: "Cam Rayner", club: "Brisbane Lions", disposals: 18, goals: 0, normSmith: false },
  { realFullName: "Darcy Wilmot", club: "Brisbane Lions", disposals: 20, goals: 0, normSmith: false },
  { realFullName: "Dayne Zorko", club: "Brisbane Lions", disposals: 28, goals: 0, normSmith: false },
] as const;

/** Looks up one player's real Grand Final box-score line by `Player.realFullName`. Returns `undefined` for anyone not in the real 46-player game (i.e. everyone who wasn't part of either club's real 23-man Grand Final side). */
export function grandFinal2026LineFor(realFullName: string): GrandFinal2026PlayerLine | undefined {
  return GRAND_FINAL_2026_BOX_SCORE.find((l) => l.realFullName === realFullName);
}
