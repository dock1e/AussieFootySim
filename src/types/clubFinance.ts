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
 * yet.** Oct 2026 ([[Injuries]]): `sportsScience`, `recovery` and `medical` are now wired too —
 * see `engine/injury.ts`. Six facilities move a real number somewhere in the engine as of round 121: `gym`/`skills`
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
  { id: "sportsScience", category: "Training", name: "Sports Science & GPS", description: "Load monitoring that cuts soft-tissue injury risk.", effectLabel: "−10% soft-tissue injury risk per level", maxLevel: 3, baseCost: 70_000, costGrowth: 1.6, wired: true },
  { id: "analytics", category: "Training", name: "Analytics & Vision Room", description: "Opposition tendencies and set-up insight before each game.", effectLabel: "match-day tactics effect (not yet wired)", maxLevel: 3, baseCost: 60_000, costGrowth: 1.6, wired: false },

  // --- Recovery: shortens time out injured (Oct 2026, [[Injuries]]) ---
  { id: "recovery", category: "Recovery", name: "Recovery Centre & Pools", description: "Players come back from injury sooner.", effectLabel: "−7% time out injured per level (concussion still costs a week)", maxLevel: 3, baseCost: 65_000, costGrowth: 1.6, wired: true },
  { id: "medical", category: "Recovery", name: "Medical & Physio Suite", description: "Faster diagnosis and rehab for every injury.", effectLabel: "−7% time out injured per level (concussion still costs a week)", maxLevel: 3, baseCost: 75_000, costGrowth: 1.6, wired: true },
  { id: "nutrition", category: "Recovery", name: "Nutrition & Sleep Program", description: "Intended to soften late-season fatigue/form drop-off.", effectLabel: "late-season fatigue (not yet wired)", maxLevel: 3, baseCost: 45_000, costGrowth: 1.55, wired: false },

  // --- Development: the direct answer to the U23 fork ---
  { id: "academy", category: "Development", name: "Next Generation Academy", description: "Deeper knowledge of junior talent in your home state — deferred to the Marketing/Draft round.", effectLabel: "draft read on home-state prospects (not yet wired)", maxLevel: 3, baseCost: 70_000, costGrowth: 1.6, wired: false },
  { id: "vfl", category: "Development", name: "VFL & Development Program", description: "Players who miss best-22 selection keep developing at a real, boosted rate instead of stagnating in the reserves.", effectLabel: "development speed for players outside the best 22", maxLevel: 4, baseCost: 100_000, costGrowth: 1.7, wired: true },
  { id: "wellbeing", category: "Development", name: "Player Wellbeing & Education", description: "Settled players are a little easier to re-sign.", effectLabel: "re-signing chance", maxLevel: 3, baseCost: 55_000, costGrowth: 1.55, wired: true },

  // --- Commercial: funds Club Finance's own revenue side ---
  { id: "fan", category: "Commercial", name: "Members & Match-Day Experience", description: "More members every season and bigger home-game takings.", effectLabel: "membership growth & match-day revenue", maxLevel: 4, baseCost: 110_000, costGrowth: 1.65, wired: true },
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
  /**
   * ROADMAP #14 real-scale rescale — the club's membership for the season currently being played.
   * Seeded from the AFL's official 2025 tally (`data/realClubFinancials.ts`), then grown or shrunk once
   * per off-season by `engine/clubFinance.ts`'s `nextMembers`. Optional (like everything added after
   * round 121) so older saves still load; `ensureFinanceBaseline` fills it in.
   */
  members?: number;
  /** Net assets (members' funds) in real dollars — the club's own balance sheet, seeded from its 2025 report and moved each off-season by the operating result less the Football Dept allocation. */
  netAssets?: number;
  /**
   * The club's fixed football-and-operating cost base, calibrated ONCE so that a first game season with
   * the real 2025 membership, the real AFL distribution and today's wage bill lands on the club's real
   * 2025 operating result (see `ensureFinanceBaseline`). Not re-derived later — a club that cuts its
   * wage bill, or grows its membership, sees that against a fixed baseline, which is the whole point.
   */
  fixedCosts?: number;
  /** One row per completed season — real 2024/2025 rows first, then every simulated season. The pride layer (Club History tab, milestones, Annual Report ceremony) reads this. */
  history?: ClubFinanceSeasonRecord[];
  /** `myClub` only: the last season whose Annual Report ceremony the coach has already seen (so it shows once per off-season). */
  annualReportSeenYear?: number;
  /** Off-cap Additional Service Payments this club has committed to (see `AspAgreement`). Optional, like every post-round-121 field. */
  aspAgreements?: AspAgreement[];
}

/**
 * ROADMAP #14 — an Additional Service Payments agreement: real AFL clubs can pay a contracted player for
 * genuine off-field commercial work (content, member events, sponsor activations) outside the
 * Total Player Payments cap. Here it's a yearly top-up negotiated alongside a contract. It counts toward
 * what the player will accept (`evaluateOffer`), never toward `committedWages`/`SALARY_CAP`, and is paid
 * from the Football Dept budget: the first season at signing, each later season at the off-season
 * advance (`engine/clubFinance.ts`'s `payAspCommitments`).
 */
export interface AspAgreement {
  playerId: number;
  amountPerYear: number;
  /** First season covered (paid at signing). */
  startYear: number;
  /** Last season covered, inclusive. */
  endYear: number;
}

/** How the board read a season — `myClub` gets one of these on every simulated history row. */
export interface BoardVerdict {
  /** Did the season meet the on-field brief the coach signed up for (`BoardSave.expectation`)? */
  onField: "exceeded" | "met" | "missed";
  /** How the operating result compared with the board's financial target. */
  finance: "record" | "ahead" | "onTarget" | "below" | "heavyLoss";
  /** 0-100, carried season to season. */
  confidence: number;
  /** The change in `confidence` this season. */
  delta: number;
  /** What the board decided about the coach's job at this review (`engine/boardReview.ts`). Absent on rows from before job security existed. */
  review?: "secure" | "warning" | "renewed" | "sacked" | "notRenewed";
  /** Set with `review: "renewed"`. */
  renewedYears?: number;
}

export interface ClubFinanceSeasonRecord {
  year: number;
  /** `real` = straight from the club's annual report (or the disclosed West Coast/GWS estimate); `sim` = a season played in this save. */
  source: "real" | "sim";
  revenue: number;
  expenses: number;
  /** Operating result (revenue − expenses). */
  result: number;
  /** Absent only on a real 2024 row whose report didn't state that year's membership. */
  members?: number;
  netAssets?: number;
  /** Football Dept discretionary allocation the club made from this season (sim rows only). */
  allocation?: number;
  /** ASP commitments paid at this off-season for the coming season (sim rows only; absent when none). */
  aspPaid?: number;
  /** Sim rows only — 1-18. */
  ladderRank?: number;
  madeFinals?: boolean;
  premiers?: boolean;
  /** Sim rows, `myClub` only. */
  board?: BoardVerdict;
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
