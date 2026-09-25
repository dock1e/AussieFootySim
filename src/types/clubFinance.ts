/**
 * [[Club Finance, Facilities, and Marketing]] — the data model for the Football Department's
 * Facilities sub-tab (round 121, first half of the two-round split Tyler asked for: "let's proceed
 * with the build using the Club Finance + Facilities features first," Marketing/campaigns and the
 * Additional Service Payments retention lever follow in a later round).
 *
 * The whole point of this system, in Tyler's own words: "the player needs to be faced with a
 * trade off... if decisions feel like they have no consequence then the player can simply just
 * re-sign all their best players every year by default without thinking... but I don't want to
 * paint them into a dead end." See the design note for the full reasoning; this file is just the
 * shape of the data that mechanic runs on.
 *
 * 13 facilities across 4 categories, numbers and structure adapted from the brief's own
 * `Club Theme System.dc.html` `FACS` table (lines ~1417-1431) — that table's own shape (id/category/
 * name/level/base/eff/step/desc) was already a strong, pre-tuned prior for exactly this trade-off,
 * so it's reused rather than invented from scratch. The DOLLAR SCALE is recalibrated, not copied:
 * the brief's own numbers assume a much bigger implied club economy than this engine's real
 * `SALARY_CAP` ($28,000,000, `engine/contracts.ts`) and `FOOTBALL_DEPT_CEILING` ($1,600,000, same
 * file — the "informational — no staff spend tracked yet" constant this whole feature finally wires
 * up) — so every cost/effect below is sized against those two real anchors instead of the brief's
 * own placeholder figures.
 *
 * **Disclosed scope split — which facilities have a REAL wired effect this round, and which don't
 * yet.** Six facilities move a real number somewhere in the engine as of round 121: `gym`/`skills`
 * (whole-list development speed, `engine/development.ts`), `vfl` (development speed for players
 * OUTSIDE the club's own best 22 specifically — the direct answer to Tyler's "maximise the
 * development of my under-23 players" fork, since `engine/progression.ts` had no such distinction
 * before this round), `wellbeing` (a re-sign-probability nudge, `engine/contracts.ts`), `fan`
 * (Club Finance's own revenue line, `engine/clubFinance.ts`), and `admin` (that same engine's running
 * costs). The remaining seven — `sportsScience`, `analytics`, `recovery`, `medical`, `nutrition`,
 * `academy`, `marketing` — are real, purchasable, persisted facility levels with real costs, but
 * their numeric effect is NOT wired this round: `sportsScience`/`recovery`/`medical`/`nutrition`
 * would need a real injury-occurrence mechanic to attach to, and this codebase has none (only the
 * in-season condition/fatigue meter `progression.ts` already models — a genuinely different thing,
 * see that file's own doc comment); `analytics`' "match-day tactics effect" has no corresponding
 * engine hook either; `academy`'s draft-read bonus and `marketing`'s campaign-return multiplier are
 * both deliberately deferred to the Marketing/ASP round this was split from, since `marketing`
 * specifically has nothing to multiply until campaigns exist. Flagged here, in the UI (each
 * `FacilityDef.wired === false`), and in the round's own doc-comment history — not silently sold as
 * fully functional.
 */

export type FacilityCategory = "Training" | "Recovery" | "Development" | "Commercial";

export type FacilityId =
  | "gym"
  | "skills"
  | "sportsScience"
  | "analytics"
  | "recovery"
  | "medical"
  | "nutrition"
  | "academy"
  | "vfl"
  | "wellbeing"
  | "fan"
  | "marketing"
  | "admin";

export interface FacilityDef {
  id: FacilityId;
  category: FacilityCategory;
  name: string;
  /** Short description of what the facility does, for the Facilities screen's card copy. */
  description: string;
  /** What real number this facility's level actually moves — see this file's own doc comment for which are wired vs not, yet. */
  effectLabel: string;
  /** Highest level this facility can reach. Every facility starts at level 0 ("not built"). */
  maxLevel: number;
  /** Dollar cost to go from level 0 to level 1 — real dollars, scaled against `FOOTBALL_DEPT_CEILING`, not the brief's own placeholder figures. */
  baseCost: number;
  /** Multiplier applied to `baseCost` per level already owned — > 1, so each successive level costs more (the brief's own diminishing-returns shape, Tyler's steer this round: "yes, add diminishing returns"). */
  costGrowth: number;
  /** `false` means this facility's level is real and purchasable, but nothing in the engine reads it yet this round — see the file-level doc comment's disclosed scope split. */
  wired: boolean;
}

/**
 * Recalibrated against `SALARY_CAP`/`FOOTBALL_DEPT_CEILING`'s real dollar scale: a club fully
 * maxing every facility here would spend low-to-mid seven figures over several real seasons of
 * accumulated discretionary budget — a genuine multi-year commitment, not a same-season purchase,
 * which is the whole point of the trade-off (every dollar spent here competes with next season's
 * retention spending once the Marketing/ASP round lands).
 */
export const FACILITY_DEFS: readonly FacilityDef[] = [
  // --- Training: whole-list development, no selection-status distinction ---
  { id: "gym", category: "Training", name: "Gym & Strength Centre", description: "Speed, endurance and strength develop faster across the whole list.", effectLabel: "whole-list development speed", maxLevel: 4, baseCost: 90_000, costGrowth: 1.65, wired: true },
  { id: "skills", category: "Training", name: "Indoor Skills Centre", description: "Kicking, handball and marking develop faster across the whole list.", effectLabel: "whole-list development speed", maxLevel: 4, baseCost: 85_000, costGrowth: 1.65, wired: true },
  { id: "sportsScience", category: "Training", name: "Sports Science & GPS", description: "Load monitoring, intended to cut soft-tissue injury risk.", effectLabel: "injury risk (not yet wired — no injury mechanic exists to attach it to)", maxLevel: 3, baseCost: 70_000, costGrowth: 1.6, wired: false },
  { id: "analytics", category: "Training", name: "Analytics & Vision Room", description: "Opposition tendencies and set-up insight before each game.", effectLabel: "match-day tactics effect (not yet wired)", maxLevel: 3, baseCost: 60_000, costGrowth: 1.6, wired: false },

  // --- Recovery: no real hook yet (no injury-occurrence mechanic in this codebase) ---
  { id: "recovery", category: "Recovery", name: "Recovery Centre & Pools", description: "Intended to speed up return-from-injury time.", effectLabel: "injury return time (not yet wired)", maxLevel: 3, baseCost: 65_000, costGrowth: 1.6, wired: false },
  { id: "medical", category: "Recovery", name: "Medical & Physio Suite", description: "Intended to speed up diagnosis and rehab for serious injuries.", effectLabel: "rehab speed (not yet wired)", maxLevel: 3, baseCost: 75_000, costGrowth: 1.6, wired: false },
  { id: "nutrition", category: "Recovery", name: "Nutrition & Sleep Program", description: "Intended to soften late-season fatigue/form drop-off.", effectLabel: "late-season fatigue (not yet wired)", maxLevel: 3, baseCost: 45_000, costGrowth: 1.55, wired: false },

  // --- Development: the direct answer to the U23 fork ---
  { id: "academy", category: "Development", name: "Next Generation Academy", description: "Deeper knowledge of junior talent in your home state — deferred to the Marketing/Draft round.", effectLabel: "draft read on home-state prospects (not yet wired)", maxLevel: 3, baseCost: 70_000, costGrowth: 1.6, wired: false },
  { id: "vfl", category: "Development", name: "VFL & Development Program", description: "Players who miss best-22 selection keep developing at a real, boosted rate instead of stagnating in the reserves.", effectLabel: "development speed for players outside the best 22", maxLevel: 4, baseCost: 100_000, costGrowth: 1.7, wired: true },
  { id: "wellbeing", category: "Development", name: "Player Wellbeing & Education", description: "Settled players are a little easier to re-sign.", effectLabel: "re-signing chance", maxLevel: 3, baseCost: 55_000, costGrowth: 1.55, wired: true },

  // --- Commercial: funds Club Finance's own revenue side ---
  { id: "fan", category: "Commercial", name: "Members & Match-Day Experience", description: "More members and bigger home crowds — the club's own base revenue line.", effectLabel: "membership & gate revenue", maxLevel: 4, baseCost: 110_000, costGrowth: 1.65, wired: true },
  { id: "marketing", category: "Commercial", name: "Marketing Department", description: "Bigger campaign returns, plus an extra concurrent campaign slot every 2 levels.", effectLabel: "marketing campaign returns & concurrent slots", maxLevel: 4, baseCost: 65_000, costGrowth: 1.6, wired: true },
  { id: "admin", category: "Commercial", name: "Administration & Data Systems", description: "Lower day-to-day football department running costs.", effectLabel: "running costs", maxLevel: 3, baseCost: 50_000, costGrowth: 1.55, wired: true },
];

/**
 * One in-flight Marketing campaign (round 122, [[Club Finance, Facilities, and Marketing]] part 2) —
 * see `types/marketing.ts`. A campaign launched during year Y matures and pays out at the END of the
 * NEXT off-season advance where `currentYear > launchedYear` (i.e. the season after the one it was
 * launched in), giving a real one-season delay between spending the cost and seeing the return —
 * `engine/clubFinance.ts`'s `advanceClubFinances` is what resolves and removes these.
 */
export interface ActiveMarketingCampaign {
  campaignId: import("./marketing.ts").MarketingCampaignId;
  launchedYear: number;
}

/** One club's Football Department finances — persisted per club (all 18, so AI clubs can invest too, not just `myClub`) in `SaveGameData.clubFinance`. */
export interface ClubFinanceState {
  /** Absent key means level 0 ("not built yet") — same sparse-record convention as `SaveGameData.lineCoaches`. */
  facilityLevels: Partial<Record<FacilityId, number>>;
  /** The discretionary Football Department budget balance, in real dollars. Never negative — see `engine/clubFinance.ts`'s `advanceClubFinances`. */
  budget: number;
  /**
   * Round 122 — in-flight Marketing campaigns. Optional so every pre-round-122 `ClubFinanceState`
   * (round 121's Facilities-only shape) keeps deserializing fine — every reader treats a missing key
   * the same as an empty array (see `engine/clubFinance.ts`'s `activeCampaignsOf` helper), never throws.
   */
  activeCampaigns?: ActiveMarketingCampaign[];
}

/**
 * A modest starting balance — enough for a club's first couple of facility purchases without
 * trivializing the choice, deliberately well under `FOOTBALL_DEPT_CEILING` so genuine growth has to
 * come from a season or two of real revenue, not an opening lump sum.
 */
export const STARTING_FOOTBALL_DEPT_BUDGET = 250_000;

export function defaultClubFinanceState(): ClubFinanceState {
  return { facilityLevels: {}, budget: STARTING_FOOTBALL_DEPT_BUDGET };
}
