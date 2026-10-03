/**
 * ROADMAP #14 follow-up — every AFL club's real senior coach at the START of each season a new game can
 * begin in, keyed by start season (`REAL_SENIOR_COACHES[2026]`, `[2027]`), plus the real out-of-work
 * senior coaches at that point (`REAL_FREE_AGENT_COACHES`). Names match `realCoachHistory.ts`'s
 * "Last, First" ledger for the career record.
 *
 * **2026 start.** Two clubs changed coach DURING the real 2026 season — Carlton (Michael Voss → Josh
 * Fraser) and Essendon (Brad Scott → Dean Solomon caretaker, then Mark McVeigh) — after the game starts,
 * so Voss and Brad Scott are the coaches of record.
 *
 * **2027 start** (as at 2 Oct 2026): Josh Fraser (Carlton, appointed permanently through 2029 — afl.com.au)
 * and Mark McVeigh (Essendon, appointed 25 Aug 2026 through 2029 — afl.com.au) are in. **Brisbane Lions**
 * (Chris Fagan retired after the 2026 three-peat — lions.com.au, ~1 Oct 2026) and **North Melbourne**
 * (Alastair Clarkson sacked, 2 Sep 2026 — SEN) have no coach appointed yet; per Tyler's steer those clubs
 * start **vacant**, and their AI boards fill them in the first off-season (or the coach takes one of
 * them). Update this table as real appointments are announced.
 *
 * **Contract ends** come from SEN's "Contract stocktake: which coaches will be extended beyond 2027?"
 * (18 May 2026): out of contract at the end of 2027 — Longmuir (rolling deal), Beveridge, Clarkson,
 * Fagan, Lyon, McQualter, Nicks, Mitchell, Brad Scott; at the end of 2028 — Carr, Hardwick, King,
 * Kingsley, McRae, Chris Scott, Yze, Cox. Voss's term wasn't reported (he was sacked mid-2026); his is
 * seeded (`seedContractEnd` in `engine/seniorCoaches.ts`), a disclosed calibration.
 */

export interface RealSeniorCoach {
  name: string;
  /** Key into `REAL_COACH_HISTORY` ("Last, First"). Omitted for a coach with no senior ledger yet. */
  historyName?: string;
  sinceYear: number;
  contractEndYear?: number;
  /** One-line pedigree when there's no senior ledger to derive one from. */
  note?: string;
}

/** `null` = the job is vacant at the start of that season. */
export const REAL_SENIOR_COACHES: Readonly<Record<number, Readonly<Record<string, RealSeniorCoach | null>>>> = {
  2026: {
    Adelaide: { name: "Matthew Nicks", historyName: "Nicks, Matthew", sinceYear: 2020, contractEndYear: 2027 },
    "Brisbane Lions": { name: "Chris Fagan", historyName: "Fagan, Chris", sinceYear: 2017, contractEndYear: 2027 },
    Carlton: { name: "Michael Voss", historyName: "Voss, Michael", sinceYear: 2022 },
    Collingwood: { name: "Craig McRae", historyName: "McRae, Craig", sinceYear: 2022, contractEndYear: 2028 },
    Essendon: { name: "Brad Scott", historyName: "Scott, Brad", sinceYear: 2023, contractEndYear: 2027 },
    Fremantle: { name: "Justin Longmuir", historyName: "Longmuir, Justin", sinceYear: 2020, contractEndYear: 2027 },
    Geelong: { name: "Chris Scott", historyName: "Scott, Chris", sinceYear: 2011, contractEndYear: 2028 },
    "Gold Coast": { name: "Damien Hardwick", historyName: "Hardwick, Damien", sinceYear: 2024, contractEndYear: 2028 },
    "Greater Western Sydney": { name: "Adam Kingsley", historyName: "Kingsley, Adam", sinceYear: 2023, contractEndYear: 2028 },
    Hawthorn: { name: "Sam Mitchell", historyName: "Mitchell, Sam", sinceYear: 2022, contractEndYear: 2027 },
    Melbourne: { name: "Steven King", historyName: "King, Steven", sinceYear: 2026, contractEndYear: 2028 },
    "North Melbourne": { name: "Alastair Clarkson", historyName: "Clarkson, Alastair", sinceYear: 2023, contractEndYear: 2027 },
    "Port Adelaide": { name: "Josh Carr", historyName: "Carr, Josh", sinceYear: 2026, contractEndYear: 2028 },
    Richmond: { name: "Adem Yze", historyName: "Yze, Adem", sinceYear: 2024, contractEndYear: 2028 },
    "St Kilda": { name: "Ross Lyon", historyName: "Lyon, Ross", sinceYear: 2023, contractEndYear: 2027 },
    Sydney: { name: "Dean Cox", historyName: "Cox, Dean", sinceYear: 2025, contractEndYear: 2028 },
    "West Coast": { name: "Andrew McQualter", historyName: "McQualter, Andrew", sinceYear: 2025, contractEndYear: 2027 },
    "Western Bulldogs": { name: "Luke Beveridge", historyName: "Beveridge, Luke", sinceYear: 2015, contractEndYear: 2027 },
  },
  2027: {
    Adelaide: { name: "Matthew Nicks", historyName: "Nicks, Matthew", sinceYear: 2020, contractEndYear: 2027 },
    "Brisbane Lions": null,
    Carlton: { name: "Josh Fraser", historyName: "Fraser, Josh", sinceYear: 2026, contractEndYear: 2029 },
    Collingwood: { name: "Craig McRae", historyName: "McRae, Craig", sinceYear: 2022, contractEndYear: 2028 },
    Essendon: { name: "Mark McVeigh", sinceYear: 2026, contractEndYear: 2029, note: "Former Sydney assistant and long-time Essendon player; first senior job" },
    Fremantle: { name: "Justin Longmuir", historyName: "Longmuir, Justin", sinceYear: 2020, contractEndYear: 2027 },
    Geelong: { name: "Chris Scott", historyName: "Scott, Chris", sinceYear: 2011, contractEndYear: 2028 },
    "Gold Coast": { name: "Damien Hardwick", historyName: "Hardwick, Damien", sinceYear: 2024, contractEndYear: 2028 },
    "Greater Western Sydney": { name: "Adam Kingsley", historyName: "Kingsley, Adam", sinceYear: 2023, contractEndYear: 2028 },
    Hawthorn: { name: "Sam Mitchell", historyName: "Mitchell, Sam", sinceYear: 2022, contractEndYear: 2027 },
    Melbourne: { name: "Steven King", historyName: "King, Steven", sinceYear: 2026, contractEndYear: 2028 },
    "North Melbourne": null,
    "Port Adelaide": { name: "Josh Carr", historyName: "Carr, Josh", sinceYear: 2026, contractEndYear: 2028 },
    Richmond: { name: "Adem Yze", historyName: "Yze, Adem", sinceYear: 2024, contractEndYear: 2028 },
    "St Kilda": { name: "Ross Lyon", historyName: "Lyon, Ross", sinceYear: 2023, contractEndYear: 2027 },
    Sydney: { name: "Dean Cox", historyName: "Cox, Dean", sinceYear: 2025, contractEndYear: 2028 },
    "West Coast": { name: "Andrew McQualter", historyName: "McQualter, Andrew", sinceYear: 2025, contractEndYear: 2027 },
    "Western Bulldogs": { name: "Luke Beveridge", historyName: "Beveridge, Luke", sinceYear: 2015, contractEndYear: 2027 },
  },
};

/** Real senior coaches out of work at the start of a season, and the club they last coached. Chris Fagan isn't here: he retired. */
export const REAL_FREE_AGENT_COACHES: Readonly<Record<number, readonly { name: string; historyName: string; lastClub: string }[]>> = {
  2026: [],
  2027: [
    { name: "Alastair Clarkson", historyName: "Clarkson, Alastair", lastClub: "North Melbourne" },
    { name: "Michael Voss", historyName: "Voss, Michael", lastClub: "Carlton" },
    { name: "Brad Scott", historyName: "Scott, Brad", lastClub: "Essendon" },
  ],
};

/** The table for a start season: that year's, or the latest one before it. */
export function realSeniorCoachesFor(year: number): Readonly<Record<string, RealSeniorCoach | null>> {
  const years = Object.keys(REAL_SENIOR_COACHES).map(Number).sort((a, b) => a - b);
  const pick = [...years].reverse().find((y) => y <= year) ?? years[0];
  return REAL_SENIOR_COACHES[pick];
}

export function realFreeAgentCoachesFor(year: number): readonly { name: string; historyName: string; lastClub: string }[] {
  return REAL_FREE_AGENT_COACHES[year] ?? [];
}

/** Back-compat alias for the 2026 table (pre-2027-start code and tests). */
export const REAL_SENIOR_COACHES_2026 = REAL_SENIOR_COACHES[2026] as Readonly<Record<string, RealSeniorCoach>>;
