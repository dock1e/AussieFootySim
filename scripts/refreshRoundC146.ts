/**
 * Round C146 — [[End-of-2026 Player Database Refresh]]. Adds 74 real players who played real
 * senior AFL games in the real 2026 season but had ZERO `Player` record in `players_master.csv`
 * (not just a missing 2026 stat row — confirmed via a full cross-reference of Tyler's uploaded
 * "Active Players AFL Mens 2026" spreadsheet sheet, filtered to `Active Player == true`, against
 * the 751-player database). Tyler explicitly confirmed all 74 should be added, not a narrower
 * subset.
 *
 * **Data source**: `data/roundC146_new_players.json` — 74 entries, each carrying real bio
 * (team/dob/height/weight/origin/draftInfo/jumper/games) plus the exact 23-column real-stat set
 * `data/real2026SeasonStats.ts` already uses. Pre-extracted and verified before this round started;
 * this script does not re-derive it from any spreadsheet.
 *
 * **Pipeline, reusing every existing established mechanism rather than inventing new ones**:
 * 1. `AttributeZScorer` (round C142, `engine/attributeGeneration.ts`) — re-instantiated over the
 *    COMBINED population of the existing 594 real-2026-stat players plus these 74 (668 total), so
 *    the 74 are z-scored against the same population they're joining, not scored in isolation.
 * 2. `recomputeOVRWithShrinkage` (round 125/126, `engine/ratingGeneration.ts`) — re-run across the
 *    FULL 825-player population (751 existing + 74 new) so OVR/POT stay internally consistent
 *    everywhere, and so these 74 (almost all with a handful of real career games on file) get the
 *    exact same games-played shrinkage every other thin-sample player gets — expected to pull them
 *    heavily toward their archetype's population mean, which is the intended fairness behaviour,
 *    not a bug.
 * 3. `draft.ts`'s established "flavour field" generation convention (imp_/deg_ pairs, clangerTend,
 *    leadership, discipline/umpire/loyalty/goHomeTend/injuryTend, potentialTall/potentialMid) reused
 *    verbatim for every field with no committed real-data formula — see the one disclosed deviation
 *    below (clangerTend).
 * 4. Initial archetype assignment — a new, narrow, disclosed heuristic (`classifyArchetypeFromReal
 *    SeniorStats` below) built for this round specifically because these 74 are REAL SENIOR AFL
 *    debutants with a full real per-game stat line, not underage prospects (`draft.ts`'s existing
 *    `archetypeGuessFromUnderageStats` operates on goals/best-per-game only, the underage-prospect
 *    signal set — a different, thinner shape of data). This is explicitly IN SCOPE per this round's
 *    brief: assigning an initial archetype to a brand-new player is how every real prospect is
 *    onboarded already; it is NOT the archetype-RECLASSIFIER for EXISTING players that an earlier
 *    round this session explicitly deferred.
 *
 * **One deliberate deviation from draft.ts's flavour-field convention, flagged for Tyler**:
 * `clangerTend` is tagged REAL in Schema.md ("directly derived from real clangers/game") and round
 * C142 already established regenerating it from real per-game clanger rate for every real player
 * with a real stat row — unlike `draft.ts`'s `buildProspect`, which defaults it to 50 only because
 * an unscouted amateur prospect has no real clanger data at all. These 74 DO have real 2026 clanger
 * data, so this script computes `clangerTend` via `AttributeZScorer.clangerTendFor` (the real-data
 * path), not the flat 50 default. Every other flavour field below (imp_/deg_, leadership,
 * discipline/umpire/loyalty/goHomeTend/injuryTend, potentialTall/potentialMid) has no committed
 * real-data formula anywhere in this codebase, so `draft.ts`'s randomised convention is reused
 * exactly, unchanged.
 *
 * **Veteran vs rookie distinction, disclosed rather than flattened**: many of the 72 non-Jagga/
 * non-Harry names have a REAL prior AFL career already on file in `data/realDraftHistory.ts` (e.g.
 * Nik Cox — pick 8, 2020, 61 career games recorded at the Aug 2026 scrape — genuinely returning
 * after a real gap, not a rookie). This script does not treat the two groups differently in the
 * generation formula itself (the games-played shrinkage in step 2 already naturally reads a
 * returning veteran's larger career-games figure and shrinks them less than a true debutant) — but
 * the verify script and this round's report call out which is which, since conflating them in
 * scouting language would misrepresent a list-retention story as a hyped rookie.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC146.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage, careerGamesFor } from "../src/engine/ratingGeneration.ts";
import { DISCRETE_SKILLS, type ImprovementRates, type DeclineRates } from "../src/types/player.ts";
import { REAL_2026_SEASON_STATS } from "../src/data/real2026SeasonStats.ts";
import type { Real2026SeasonStats } from "../src/data/real2026SeasonStats.ts";
import { AttributeZScorer } from "../src/engine/attributeGeneration.ts";
import { draftHistoryFor } from "../src/data/realDraftHistory.ts";
import { clubByName } from "../src/types/club.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC146.csv");
const NEW_PLAYERS_PATH = join(__dirname, "..", "data", "roundC146_new_players.json");

interface NewPlayerRaw {
  realFullName: string;
  team: string;
  dob: string;
  height: string;
  weight: string;
  origin: string | null;
  draftInfo: string | null;
  jumper: number | null;
  games: number | null;
  kicks: number | null;
  marks: number | null;
  handballs: number | null;
  disposals: number | null;
  goals: number | null;
  behinds: number | null;
  hitouts: number | null;
  tackles: number | null;
  rebound50s: number | null;
  inside50s: number | null;
  clearances: number | null;
  clangers: number | null;
  freesFor: number | null;
  freesAgainst: number | null;
  brownlowVotes: number | null;
  contestedPoss: number | null;
  uncontestedPoss: number | null;
  contestedMarks: number | null;
  marksInside50: number | null;
  onePercenters: number | null;
  bounces: number | null;
  goalAssists: number | null;
}

function n(v: number | null | undefined): number {
  return v ?? 0; // null real-stat cells treated as 0 for z-score input — same convention real2026SeasonStats.ts's existing 594 rows already use for sparse columns
}

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Simple, stable string hash (djb2) -> unsigned 32-bit int — same idiom draft.ts's own `hashSeed` uses, reused here to seed a deterministic per-player mulberry32 stream off `realFullName` (stable across re-runs, unlike PlayerID assignment order). */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}

/** "First Last" (or "First Middle Last") -> {first, last}, first word is fname, everything else joins as lname — the exact convention `draft.ts`'s own `splitRealName` uses, confirmed against existing multi-word players_master.csv rows ("Jacob van Rooyen" -> fname "Jacob"/lname "van Rooyen"; "Nasiah Wanganeen-Milera" -> fname "Nasiah"/lname "Wanganeen-Milera" — hyphenated surnames kept as one token, not split further). */
function splitRealName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? name, last: parts.slice(1).join(" ") || parts[0] || name };
}

// --- Name-alias fixes, disclosed rather than silent ---
// "Balyn OBrien": the extraction JSON's realFullName lost the apostrophe present in
// data/realDraftHistory.ts's real "Balyn O'Brien" row — restored here so the draft-history join
// and fname/lname split both match the rest of this codebase's apostrophe convention (O'Brien,
// D'Ambrosio, etc).
// "Cameron Nairn": the JSON's own draftInfo is null (no clean draft text at all, per this round's
// brief) — but a real draftguru.com.au row for "Cam Nairn" (2025, National, pick 20, Hawthorn)
// exists in realDraftHistory.ts, and the club (Hawthorn) matches this entry's own `team` exactly.
// Treated as the same real person under a nickname, the same class of accepted match round C142's
// SuperCoach recalibration pass already used for "Robert Hansen Jr"/"Mitchell Hinge"/"Joshua
// Draper" — disclosed here, not silently assumed.
const NAME_JOIN_ALIAS: Record<string, string> = {
  "Balyn OBrien": "Balyn O'Brien",
  "Cameron Nairn": "Cam Nairn",
};
const DISPLAY_NAME_FIX: Record<string, string> = {
  "Balyn OBrien": "Balyn O'Brien",
};

interface ParsedDraftInfo {
  pick: number; // 0 (NOT_YET_DRAFTED sentinel, draft.ts's own convention) when no real pick number exists
  year: number;
  draftType: string;
}

/** Best-effort parse of the free-text `draftInfo` field — only used as a FALLBACK when no usable `realDraftHistory.ts` row exists (see `resolveDraftInfo` below), since draftguru-sourced structured data is the more reliable REAL source per Schema.md's own provenance convention. Takes the first "/"-separated segment (the original/earliest draft entry) when more than one is listed. */
function parseDraftInfoText(text: string, fallbackYear: number): ParsedDraftInfo {
  const firstSegment = text.split("/")[0].trim();
  const yearMatch = firstSegment.match(/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : fallbackYear;
  const pickMatch = firstSegment.match(/#(\d+)/);
  const pick = pickMatch ? Number(pickMatch[1]) : 0;

  let draftType: string;
  if (/Mid-Season/i.test(firstSegment)) draftType = "Mid-Season Draft";
  else if (/National Draft/i.test(firstSegment)) draftType = "National Draft";
  else if (/Rookie Draft/i.test(firstSegment) && !/Mid-Season/i.test(firstSegment)) draftType = "Rookie Draft";
  else if (/Category B/i.test(firstSegment)) draftType = firstSegment.replace(/\s*\d{4}\)?$/, "").replace(/\(.*$/, "").trim() || "Category B Rookie Selection";
  else if (/Supplemental Selection|SSP/i.test(firstSegment)) draftType = "Pre-Season Supplemental Selection (SSP)";
  else draftType = firstSegment.replace(/\s*\d{4}\)?$/, "").trim() || "Unknown";

  return { pick, year, draftType };
}

const HISTORY_DRAFT_TYPE_MAP: Record<string, string> = {
  National: "National Draft",
  Rookie: "Rookie Draft",
  "Pre-Season": "Pre-Season Draft",
  "Mid-Season": "Mid-Season Draft",
};

/**
 * `draft_pick`/`draft_year`/`draft_draftType` for one of the 74, preferring the REAL, structured
 * `realDraftHistory.ts` row (draftguru.com.au-sourced — same provenance discipline Schema.md
 * documents for the other 623 real `draft_pick` values) over the free-text `draftInfo` field
 * whenever a usable numbered-pick row exists. Falls back to parsing `draftInfo` only when
 * `realDraftHistory.ts` has no row at all, or only a no-pick-number row (Post-Draft/Pre-Draft/FA/
 * Trade — real signings that genuinely never had a draft pick, not a data gap) — in which case the
 * richer free-text category (Category B Rookie Selection, SSP, NGA, etc) is kept as the disclosed
 * `draft_draftType` rather than the generic history label, and `draft_pick` is left at `0`
 * (NOT_YET_DRAFTED, draft.ts's own sentinel) rather than fabricated.
 */
function resolveDraftInfo(realFullName: string, draftInfoText: string | null): { pick: number; year: number; draftType: string; source: string } {
  const lookupName = NAME_JOIN_ALIAS[realFullName] ?? realFullName;
  const rows = draftHistoryFor(lookupName);
  const pickRows = rows
    .filter((r) => r.pickNumber != null && HISTORY_DRAFT_TYPE_MAP[r.draftType])
    .sort((a, b) => a.year - b.year);

  if (pickRows.length > 0) {
    const row = pickRows[0];
    return { pick: row.pickNumber!, year: row.year, draftType: HISTORY_DRAFT_TYPE_MAP[row.draftType], source: "realDraftHistory.ts (draftguru.com.au)" };
  }

  if (draftInfoText) {
    const parsed = parseDraftInfoText(draftInfoText, rows[0]?.year ?? 2026);
    return { ...parsed, source: rows.length > 0 ? "draftInfo text (realDraftHistory.ts row has no numbered pick)" : "draftInfo text (no realDraftHistory.ts row at all)" };
  }
  if (rows.length > 0) {
    const row = rows[0];
    return { pick: 0, year: row.year, draftType: row.draftType, source: "realDraftHistory.ts (no numbered pick, no draftInfo text)" };
  }
  return { pick: 0, year: 2026, draftType: "Unknown (no draft record found)", source: "none — disclosed gap" };
}

const STATE_KEYWORDS: readonly (readonly [string, readonly string[]])[] = [
  ["NT", ["NT Thunder", "Darwin", "Nightcliff", "Katherine (NT)"]],
  ["TAS", ["Tasmania"]],
  ["QLD", ["Southport", "Labrador", "Allies"]],
  ["WA", ["Peel", "West Perth", "South Fremantle", "Subiaco", "Claremont", "Swan Districts", "East Perth", "Joondalup", "Mandurah", "Jandakot", "Whitford"]],
  ["SA", ["Norwood", "Sturt", "West Adelaide", "South Adelaide", "Central District", "Glenelg", "Woodville", "North Adelaide", "Prince Alfred", "Tanunda", "Barossa", "Gawler", "Athelstone", "Walkerville", "Unley", "Port District", "Parkside", "Lockleys", "Mallee Park", "Central Eyre"]],
  ["NSW", ["Sydney Swans Academy", "NSW-ACT Rams", "North Shore (NSW)", "UNSW", "Sawtell-Toormina", "Queanbeyan", "St Ives"]],
  ["VIC", ["Sandringham", "Oakleigh", "Calder", "Eastern Ranges", "Northern Knights", "Northern U18", "Dandenong", "Gippsland", "Geelong", "Bendigo", "Murray Bushrangers", "Western Jets", "Coburg", "Williamstown", "Frankston", "Casey", "Werribee", "Sunbury", "Montmorency", "Ivanhoe", "Point Cook", "Brighton", "Malvern", "Rowville", "Glen Iris", "Vermont", "Northcote", "Bunyip", "Warragul", "Beaconsfield", "Colac", "South Barwon", "Wodonga", "Shepparton", "Ormond", "McKinnon", "South Morang", "Aberfeldie", "Blackburn", "Kew Rovers", "Ballarat", "Footscray"]],
];

function deriveHomeState(origin: string | null, clubHomeState: string): string {
  if (!origin) return clubHomeState;
  let bestState: string | null = null;
  let bestIndex = Infinity;
  for (const [state, keywords] of STATE_KEYWORDS) {
    for (const kw of keywords) {
      const idx = origin.indexOf(kw);
      if (idx >= 0 && idx < bestIndex) {
        bestIndex = idx;
        bestState = state;
      }
    }
  }
  return bestState ?? clubHomeState;
}

const ARCHETYPE_AVG_WEIGHT: Record<Archetype, number> = {
  "Inside Mid": 84,
  "Outside Mid": 82,
  "Pressure Forward": 77,
  "Hybrid Mid Forward": 88,
  "Small Forward": 76,
  "Medium Forward": 86,
  Ruck: 104,
  "Key Forward": 95,
  "Hybrid Key Forward Ruck": 100,
  "Medium Defender": 88,
  "Intercept Defender": 88,
  "Half Back Flanker": 81,
  "Back Pocket": 82,
  "Key Defender": 94,
};

function classifyArchetypeFromRealSeniorStats(raw: NewPlayerRaw, heightCm: number): { archetype: Archetype; reason: string } {
  const g = n(raw.games) > 0 ? n(raw.games) : 1;
  const hoPg = n(raw.hitouts) / g;
  const mkPg = n(raw.marks) / g;
  const cmPg = n(raw.contestedMarks) / g;
  const mi5Pg = n(raw.marksInside50) / g;
  const glPg = n(raw.goals) / g;
  const tkPg = n(raw.tackles) / g;
  const cpPg = n(raw.contestedPoss) / g;
  const upPg = n(raw.uncontestedPoss) / g;
  const clPg = n(raw.clearances) / g;
  const r50Pg = n(raw.rebound50s) / g;
  const onePctPg = n(raw.onePercenters) / g;
  const diPg = n(raw.disposals) / g;

  if (hoPg >= 3) {
    if ((glPg >= 0.4 || mi5Pg >= 0.15) && heightCm < 205) {
      return { archetype: "Hybrid Key Forward Ruck", reason: `Ruck minutes (${hoPg.toFixed(1)} HO/g) plus real forward output (goals ${glPg.toFixed(2)}/g)` };
    }
    return { archetype: "Ruck", reason: `Dominant hitouts (${hoPg.toFixed(1)}/g)` };
  }

  const forwardScore = glPg * 4 + mi5Pg * 2 + cmPg * 1 + mkPg * 0.3;
  const midInScore = clPg * 3 + cpPg * 0.5 + tkPg * 0.4;
  const midOutScore = upPg * 0.35 + diPg * 0.15;
  const midScore = Math.max(midInScore, midOutScore);
  const defScore = r50Pg * 3 + onePctPg * 1.2;

  if (forwardScore >= midScore && forwardScore >= defScore) {
    let archetype: Archetype;
    if (heightCm >= 193) archetype = "Key Forward";
    else if (heightCm < 180 && tkPg >= 2.5) archetype = "Pressure Forward";
    else if (heightCm < 180) archetype = "Small Forward";
    else if (clPg >= 2 || cpPg >= 8) archetype = "Hybrid Mid Forward";
    else archetype = "Medium Forward";
    return { archetype, reason: `forward profile: goals ${glPg.toFixed(2)}/g, marksInside50 ${mi5Pg.toFixed(2)}/g, height ${heightCm}cm` };
  }

  if (defScore >= forwardScore && defScore >= midScore) {
    let archetype: Archetype;
    if (heightCm >= 193) archetype = "Key Defender";
    else if (r50Pg >= 3 && diPg >= 15) archetype = "Intercept Defender";
    else if (heightCm < 182) archetype = "Back Pocket";
    else if (r50Pg >= 2.5) archetype = "Half Back Flanker";
    else archetype = "Medium Defender";
    return { archetype, reason: `defensive profile: rebound50s ${r50Pg.toFixed(2)}/g, one-percenters ${onePctPg.toFixed(2)}/g, height ${heightCm}cm` };
  }

  const archetype: Archetype = midInScore >= midOutScore ? "Inside Mid" : "Outside Mid";
  return { archetype, reason: `midfield profile: clearances ${clPg.toFixed(2)}/g, contested poss ${cpPg.toFixed(2)}/g, uncontested poss ${upPg.toFixed(2)}/g` };
}

function parseHeightCm(s: string): number {
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : 183;
}

function parseWeightKg(s: string): number | null {
  const m = s.match(/(\d+)/);
  const v = m ? Number(m[1]) : 0;
  return v > 0 ? v : null;
}

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [header] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  const existingPlayers: Player[] = rawRows.map(coerceRow);
  console.log(`Parsed ${existingPlayers.length} existing players`);

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-refresh CSV -> ${BACKUP_PATH}`);

  const newRaw: NewPlayerRaw[] = JSON.parse(readFileSync(NEW_PLAYERS_PATH, "utf-8"));
  console.log(`Loaded ${newRaw.length} new real players from ${NEW_PLAYERS_PATH}`);
  if (newRaw.length !== 74) throw new Error(`Expected 74 new players, found ${newRaw.length}`);

  const existingIds = new Set(existingPlayers.map((p) => p.PlayerID));
  const existingNames = new Set(existingPlayers.map((p) => p.realFullName ?? `${p.fname} ${p.lname}`));
  let nextId = Math.max(...existingIds) + 1;

  const newAsSeasonStats: Real2026SeasonStats[] = newRaw.map((r) => ({
    realFullName: r.realFullName,
    games: n(r.games),
    kicks: n(r.kicks),
    marks: n(r.marks),
    handballs: n(r.handballs),
    disposals: n(r.disposals),
    goals: n(r.goals),
    behinds: n(r.behinds),
    hitouts: n(r.hitouts),
    tackles: n(r.tackles),
    rebound50s: n(r.rebound50s),
    inside50s: n(r.inside50s),
    clearances: n(r.clearances),
    clangers: n(r.clangers),
    freesFor: n(r.freesFor),
    freesAgainst: n(r.freesAgainst),
    brownlowVotes: n(r.brownlowVotes),
    contestedPoss: n(r.contestedPoss),
    uncontestedPoss: n(r.uncontestedPoss),
    contestedMarks: n(r.contestedMarks),
    marksInside50: n(r.marksInside50),
    onePercenters: n(r.onePercenters),
    bounces: n(r.bounces),
    goalAssists: n(r.goalAssists),
  }));
  const combinedSeasonStats = [...REAL_2026_SEASON_STATS, ...newAsSeasonStats];
  const scorer = new AttributeZScorer(combinedSeasonStats);
  console.log(`Built AttributeZScorer over ${combinedSeasonStats.length} real-2026-stat players (${REAL_2026_SEASON_STATS.length} existing + ${newAsSeasonStats.length} new)`);

  const referenceDate = new Date("2026-09-27T00:00:00Z");

  const veteranNotes: { name: string; note: string }[] = [];
  const newPlayers: Player[] = [];

  for (const raw of newRaw) {
    if (existingNames.has(raw.realFullName)) {
      throw new Error(`realFullName collision: "${raw.realFullName}" already exists in players_master.csv`);
    }
    const club = clubByName(raw.team);
    if (!club) throw new Error(`Unknown club "${raw.team}" for ${raw.realFullName}`);

    const heightCm = parseHeightCm(raw.height);
    const { archetype, reason: archetypeReason } = classifyArchetypeFromRealSeniorStats(raw, heightCm);
    const parsedWeight = parseWeightKg(raw.weight);
    const weightKg = parsedWeight ?? ARCHETYPE_AVG_WEIGHT[archetype];
    const weightDisclosed = parsedWeight == null;

    const homeState = deriveHomeState(raw.origin, club.homeState);

    const dob = new Date(raw.dob.replace(" ", "T") + "Z");
    let age = referenceDate.getUTCFullYear() - dob.getUTCFullYear();
    const hadBirthdayYet = referenceDate.getUTCMonth() > dob.getUTCMonth() || (referenceDate.getUTCMonth() === dob.getUTCMonth() && referenceDate.getUTCDate() >= dob.getUTCDate());
    if (!hadBirthdayYet) age -= 1;

    const draftInfo = resolveDraftInfo(raw.realFullName, raw.draftInfo);

    const { first, last } = splitRealName(DISPLAY_NAME_FIX[raw.realFullName] ?? raw.realFullName);

    const rng = mulberry32(hashSeed(raw.realFullName));

    const impDegRaw: Record<string, number> = {};
    for (const skill of DISCRETE_SKILLS) {
      impDegRaw[`imp_${skill}`] = clip(Math.round(30 + rng() * 45), 1, 99);
      impDegRaw[`deg_${skill}`] = clip(Math.round(5 + rng() * 20), 1, 99);
    }
    const impDeg = impDegRaw as unknown as ImprovementRates & DeclineRates;

    const potentialTall = clip(Math.round(68 + (rng() - 0.5) * 40), 1, 99);
    const potentialMid = clip(Math.round(68 + (rng() - 0.5) * 40), 1, 99);

    const attrs = scorer.attributesFor(raw.realFullName, archetype);
    const clangerTend = scorer.clangerTendFor(raw.realFullName);

    const player: Player = {
      PlayerID: nextId++,
      Team: club.name,
      OriginClub: club.name,
      ClubID: club.ClubID,
      fname: first,
      lname: last,
      homeState,
      height: heightCm,
      weight: weightKg,
      Age: age,
      age_day: dob.getUTCDate(),
      age_month: dob.getUTCMonth() + 1,
      age_year: dob.getUTCFullYear(),
      condition: 90,

      ...attrs,
      potentialTall,
      potentialMid,

      ...impDeg,

      diciplineMatch: 50,
      disciplineTraining: 50,
      disiciplineOffFirned: 50,
      umpireLikes: 50,
      umpireNotice: 50,
      goHomeTend: 50,
      injuryTend: 20,
      loyaltyTend: 50,
      clangerTend,
      leadership: 50,

      totalValue: 140_000,
      jumperNumber: raw.jumper ?? 0,
      signed_day: 1,
      signed_month: 1,
      signed_year: 2026,
      expired_day: 1,
      expired_month: 1,
      expired_year: 2028,

      draft_pick: draftInfo.pick,
      draft_year: draftInfo.year,
      draft_draftType: draftInfo.draftType,

      archetype,
      archetype_reason: archetypeReason,

      stat_GM: n(raw.games),
      stat_DI: n(raw.disposals),
      stat_KI: n(raw.kicks),
      stat_HB: n(raw.handballs),
      stat_MK: n(raw.marks),
      stat_TK: n(raw.tackles),
      stat_CL: n(raw.clearances),
      stat_GL: n(raw.goals),
      stat_HO: n(raw.hitouts),
      stat_CM: n(raw.contestedMarks),
      stat_CP: n(raw.contestedPoss),
      stat_UP: n(raw.uncontestedPoss),
      stat_1pct: n(raw.onePercenters),

      OVR: 28,
      POT: 28,

      sc_trend_z: "",
      sc_trend_years: "",
    };

    newPlayers.push(player);

    const historyRows = draftHistoryFor(NAME_JOIN_ALIAS[raw.realFullName] ?? raw.realFullName);
    const historyMaxGames = historyRows.length > 0 ? Math.max(...historyRows.map((r) => r.games)) : 0;
    const thisYearGames = n(raw.games);
    const priorCareerGames = Math.max(0, historyMaxGames - thisYearGames);
    if (priorCareerGames >= 5) {
      veteranNotes.push({ name: raw.realFullName, note: `returning veteran with real prior AFL history (${historyMaxGames} career games on file at the Aug 2026 draftguru scrape, ~${priorCareerGames} before this 2026 return)${weightDisclosed ? " [weight defaulted]" : ""}` });
    } else {
      veteranNotes.push({ name: raw.realFullName, note: `genuine 2025-draft-class rookie debut (no real senior games before 2026)${weightDisclosed ? " [weight defaulted]" : ""}` });
    }
  }

  console.log(`Built ${newPlayers.length} new Player rows, PlayerIDs ${newPlayers[0].PlayerID}-${newPlayers[newPlayers.length - 1].PlayerID}`);

  const weightDisclosedCount = newRaw.filter((r) => parseWeightKg(r.weight) == null).length;
  console.log(`Weight defaulted to archetype-typical average for ${weightDisclosedCount} of 74 players (source spreadsheet's "0 kg" placeholder)`);

  const combined = [...existingPlayers, ...newPlayers];
  console.log(`Running recomputeOVRWithShrinkage across ${combined.length} players (751 existing + 74 new)`);

  const beforeExistingOvrPot = new Map(existingPlayers.map((p) => [p.PlayerID, { OVR: p.OVR, POT: p.POT }]));
  const refreshed = recomputeOVRWithShrinkage(combined, 99);

  const violations = refreshed.filter((p) => p.POT < p.OVR);
  if (violations.length > 0) {
    throw new Error(`POT >= OVR invariant violated for ${violations.length} players: ${violations.map((p) => p.realFullName ?? `${p.fname} ${p.lname}`).join(", ")}`);
  }
  console.log(`POT >= OVR invariant holds for all ${refreshed.length} players.`);

  let minDelta = 0;
  let maxDelta = 0;
  let sumAbsDelta = 0;
  let countChanged = 0;
  for (const p of refreshed) {
    const before = beforeExistingOvrPot.get(p.PlayerID);
    if (!before) continue;
    const ovrDelta = p.OVR - before.OVR;
    const potDelta = p.POT - before.POT;
    minDelta = Math.min(minDelta, ovrDelta, potDelta);
    maxDelta = Math.max(maxDelta, ovrDelta, potDelta);
    sumAbsDelta += Math.abs(ovrDelta) + Math.abs(potDelta);
    if (ovrDelta !== 0 || potDelta !== 0) countChanged++;
  }
  console.log(`Existing 751 ripple: OVR/POT delta min ${minDelta}, max ${maxDelta}, mean abs ${(sumAbsDelta / (2 * beforeExistingOvrPot.size)).toFixed(3)}, ${countChanged} players shifted at all`);

  for (const spotName of ["Jagga Smith", "Harry Dean"]) {
    const p = refreshed.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === spotName);
    if (!p) throw new Error(`Spotlight player ${spotName} not found after refresh`);
    console.log(`SPOTLIGHT ${spotName}: OVR ${p.OVR}, POT ${p.POT}, archetype ${p.archetype} (${p.archetype_reason}), draft_pick ${p.draft_pick} ${p.draft_draftType} ${p.draft_year}, career games (shrinkage input) ${careerGamesFor(p)}`);
  }

  console.log("\n--- Veteran vs rookie-debut classification (all 74) ---");
  for (const v of veteranNotes) console.log(`${v.name}: ${v.note}`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
