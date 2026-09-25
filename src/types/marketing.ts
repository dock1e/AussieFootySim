/**
 * [[Club Finance, Facilities, and Marketing]] — round 122, the Marketing half of the two-round split
 * Tyler asked for ("let's proceed with the build using the Club Finance + Facilities features first" —
 * round 121 was that first half; this is the second). Names the 7 campaigns the design note's own
 * section 3 lists verbatim (Membership Drive, Social & Content Series, Sponsor Pitch, Community
 * Clinics, Retro Guernsey Launch, Family Day, Sell a Home Game Interstate).
 *
 * **Disclosed: no source-of-truth numbers existed to copy.** The design note's own "CAMPS table"
 * reference points at a mockup (`Club Theme System.dc.html`'s Marketing tab) that renders from
 * placeholder hint values, not real authored data — there is no actual cost/duration/return/risk table
 * anywhere in the vault to pull from. Every number below is a fresh calibration against this engine's
 * real scale (`STARTING_FOOTBALL_DEPT_BUDGET` $250k, `FACILITY_DEFS`' $45k-110k facility costs), not a
 * copy of anything Tyler specified — flagged here rather than presented as sourced.
 *
 * **Duration is flavour text, not a real tick.** This engine has no weekly in-season loop for a
 * campaign to run through — finance only advances once per off-season (`engine/clubFinance.ts`'s
 * `advanceClubFinances`). So every campaign actually resolves in exactly one real step: launch it this
 * season, and it pays out (with real risk-tier variance) at the END of the NEXT off-season advance —
 * see `ActiveMarketingCampaign`'s own doc comment in `types/clubFinance.ts`. `durationWeeks` is kept
 * purely as UI copy ("a 6-week campaign") since it's part of what the design note and its reference
 * mockup both picture, but nothing in the engine reads it as a tick count.
 */

export type MarketingCampaignId = "membership" | "social" | "sponsor" | "clinics" | "guernsey" | "familyDay" | "interstate";

export type CampaignRisk = "Low" | "Medium" | "High";

export interface MarketingCampaignDef {
  id: MarketingCampaignId;
  name: string;
  description: string;
  /** Up-front cost, deducted from the Football Department budget the moment it's launched. */
  cost: number;
  /** Flavour only — see this file's own doc comment for why nothing in the engine reads this as a tick count. */
  durationWeeks: number;
  /** The return this campaign would pay out at NO risk-tier variance (i.e. a `Low`-risk campaign lands close to this; a `High`-risk one can land far from it either way) — see `engine/clubFinance.ts`'s `resolveCampaignReturn`. */
  expectedReturn: number;
  risk: CampaignRisk;
  /** One real disclosed side-effect some campaigns have beyond their revenue return, per the design note's own examples — purely descriptive; not read by any engine code this round (see the design note's round 122 addendum for why a real mechanical hook was deliberately left for a later round rather than invented here). */
  sideEffectNote?: string;
}

export const MARKETING_CAMPAIGNS: readonly MarketingCampaignDef[] = [
  {
    id: "membership",
    name: "Membership Drive",
    description: "A season-long push to sign up new members before Round 1.",
    cost: 35_000,
    durationWeeks: 6,
    expectedReturn: 55_000,
    risk: "Low",
  },
  {
    id: "social",
    name: "Social & Content Series",
    description: "A run of behind-the-scenes video content across the club's own channels.",
    cost: 20_000,
    durationWeeks: 8,
    expectedReturn: 32_000,
    risk: "Low",
  },
  {
    id: "sponsor",
    name: "Sponsor Pitch",
    description: "A dedicated pitch deck and meeting round with prospective major sponsors.",
    cost: 55_000,
    durationWeeks: 4,
    expectedReturn: 95_000,
    risk: "Medium",
  },
  {
    id: "clinics",
    name: "Community Clinics",
    description: "Free holiday clinics for juniors across the club's home region.",
    cost: 25_000,
    durationWeeks: 5,
    expectedReturn: 38_000,
    risk: "Low",
    sideEffectNote: "Plausibly strengthens a home-region academy read down the line — not wired to anything yet (the Academy facility itself is still unwired too, see Facilities).",
  },
  {
    id: "guernsey",
    name: "Retro Guernsey Launch",
    description: "A limited heritage-design guernsey release timed for a marquee home game.",
    cost: 45_000,
    durationWeeks: 3,
    expectedReturn: 75_000,
    risk: "Medium",
  },
  {
    id: "familyDay",
    name: "Family Day",
    description: "A free open training session and fan day at home base.",
    cost: 15_000,
    durationWeeks: 2,
    expectedReturn: 24_000,
    risk: "Low",
  },
  {
    id: "interstate",
    name: "Sell a Home Game Interstate",
    description: "Relocate one home fixture to a neutral interstate venue for a guaranteed sanctioning fee.",
    cost: 20_000,
    durationWeeks: 1,
    expectedReturn: 160_000,
    risk: "High",
    sideEffectNote: "A real, disclosed one-off tension per the design note: big guaranteed upside on paper, but the highest-variance campaign here — a real live risk to home-crowd goodwill some seasons, not just a bigger number every time.",
  },
];

export function marketingCampaignDef(id: MarketingCampaignId): MarketingCampaignDef {
  const def = MARKETING_CAMPAIGNS.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown marketing campaign id: ${id}`);
  return def;
}
