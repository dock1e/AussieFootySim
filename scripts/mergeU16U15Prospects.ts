/**
 * Round 87 — one-time data-load script, run once and kept for provenance (matches
 * `buildRealProspects.ts`'s own "rerunnable pipeline, not a throwaway" convention, but this
 * particular step is a genuine one-off append, not something to run repeatedly against the same
 * source — rerunning it against an unchanged `data/u16_u15_community_2026.json` would try to
 * re-append the same 388 records and trip the duplicate-identity check by design).
 *
 * Two independent things Tyler asked for in one round:
 *
 * (1) **Ingest `data/u16_u15_community_2026.json`** — 388 real U15/U16/Under-17.5/U18 junior
 * players from Victorian community leagues (Geelong & District, EDFL, Gippsland regions, Goulburn
 * Valley, YJFL, WFNL, RDFNL, NFNL, F&DJFL — every club/competition name checked against real
 * Victorian junior football, see this round's ROADMAP entry), extracted + deduplicated from
 * Tyler's own "U16 U15 Boys.xlsx" (26 exact-duplicate rows — a confirmed accidental copy-paste
 * block repeat in the source spreadsheet's own Sheet1 — dropped before this file ever saw them;
 * see the Python extraction step's own stderr log). Tyler's own words: these players are "too
 * early in their career" for write-ups, so every new record gets `writeups: []`, `positionRaw:
 * null`, `heightCm: null`, `dob: null` — the exact same "thin" shape the majority of the EXISTING
 * 1,298 real prospects already have (Fork E, `realProspects.ts`'s own doc comment) — no new schema
 * needed, this batch is just more of the same case the schema was already built to handle.
 * `homeState: "VIC"` is the one enrichment beyond bare-minimum-thin: every source
 * league/competition named is a real, checked Victorian junior competition, so this is a confirmed
 * fact, not a guess (unlike `engine/draft.ts`'s own `STATE_WEIGHTS`, which random-draws state for
 * a real prospect with genuinely no geographic signal at all).
 *
 * (2) **Normalize every existing real prospect's name** — Tyler: "some players missing
 * capitalization, or other players who have things full capitalization." Confirmed by direct
 * audit: 45 of the 1,298 existing names have a genuinely all-lowercase or ALL-CAPS word
 * (`archie mckie`, `JACKSON Butterworth`, `RHYS MUIR DORAZIO`, etc.) — see `cleanProspectName`'s
 * own doc comment for the exact word-level rule and why it deliberately does NOT touch an
 * already-mixed-case word like "Mcintosh" or "El" (no reliable way to verify a SPECIFIC real
 * spelling beyond "this word is obviously not cased at all"). Tyler also mentioned seeing
 * "(NSW, Player ID 9120)"-style trailing junk on a few names — audited directly and NOT found
 * anywhere in the current `real_prospects_master.json`, the new xlsx, or any other `data/realXxx.ts`
 * file in this repo (checked `realDraftHistory.ts`, `realDraftPowerRankings.ts`, `players_master.csv`
 * too) — so `cleanProspectName` strips it defensively (a no-op today) rather than leaving the
 * codebase unprotected against a future data drop that does carry it, same "wire it through anyway"
 * precedent `realProspects.ts`'s own `mvpCount` field already uses.
 *
 * One of the 45 renamed names, "Khaled El souki" -> "Khaled El Souki", is a genuinely interesting
 * case: `realDraftPowerRankings.ts` already had a doc comment explicitly explaining it deliberately
 * matched this SAME lowercase typo in its own `matchedRecordName` field, rather than fix it, so its
 * exact-string lookup wouldn't break. That reverse-accommodation gets undone in this same round —
 * see `realDraftPowerRankings.ts`'s own updated doc comment.
 *
 * Run with: `node --experimental-strip-types data/../../mergeU16U15Prospects.ts` from the app's
 * `scripts/` layout convention — see this round's ROADMAP entry for the exact command actually used.
 */
import { readFileSync, writeFileSync } from "node:fs";

const MASTER_PATH = "/sessions/modest-wizardly-ritchie/mnt/AussieFootySim/app/data/real_prospects_master.json";
const NEW_DATA_PATH = "/sessions/modest-wizardly-ritchie/mnt/AussieFootySim/app/data/u16_u15_community_2026.json";

interface RawRecord {
  name: string;
  normName: string;
  team: string | null;
  positionRaw: string | null;
  heightCm: number | null;
  dob: [number, number, number] | null;
  writeups: string[];
  standoutSourceEvents: string[];
  standoutStats: Record<string, number> | null;
  gamesInStandout: number;
  seasonStats: {
    gamesPlayed: number;
    goals: number;
    bestCount: number;
    mvpCount: number;
    finalsPlayer: boolean;
    u18WcFinalsPlayer: boolean;
  } | null;
  aflFutures: boolean;
  ageGroupSheet: "U16" | "U18" | "U15" | "U17.5" | null;
  sourceSheets: string[];
  homeState: string | null;
}

interface NewCommunityRecord {
  name: string;
  team: string;
  ageGroup: "U15" | "U16" | "U17.5" | "U18";
  gamesPlayed: number;
  goals: number;
  bestCount: number;
  bestTracked: boolean;
}

// ---------------------------------------------------------------------------
// Name cleaning — see this file's own top doc comment, point (2).
// ---------------------------------------------------------------------------

/**
 * Surname/given-name particles that stay lowercase mid-name in real usage (Dutch/German/French
 * naming conventions genuinely present in this codebase's own real data — e.g. `realDraftHistory.ts`
 * has "Jacob van Rooyen", "Matt de Boer", "Jake von Bertouch"). Checked defensively here even though
 * none of the 45 flagged bad-case names in `real_prospects_master.json` actually contain one — this
 * only matters if a WORD is otherwise being rewritten (all-lower or ALL-CAPS), so it can never turn
 * an already-correct "van"/"de" into something wrong; it can only stop this script from WRONGLY
 * capitalizing one that happened to get swept up in an ALL-CAPS or all-lowercase name.
 */
const LOWERCASE_NAME_PARTICLES = new Set(["van", "von", "der", "den", "de", "la", "le", "di", "da", "du", "dos", "das"]);

/**
 * Title-cases one word, with two real-surname conventions applied on top of plain
 * first-letter-capitalization: "Mc"/"Mac" + capitalize the next letter (McKie, MacRae — the
 * overwhelmingly common real convention; a rare exception like "Macklin" is a disclosed, accepted
 * residual risk given how much more often the convention is right than wrong), and capitalize the
 * letter right after an apostrophe (O'Brien, D'Antonio — unambiguous, no real exceptions).
 */
function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  let base: string;
  if (lower.startsWith("mac") && lower.length > 3) {
    base = "Mac" + lower[3].toUpperCase() + lower.slice(4);
  } else if (lower.startsWith("mc") && lower.length > 2) {
    base = "Mc" + lower[2].toUpperCase() + lower.slice(3);
  } else {
    base = lower[0].toUpperCase() + lower.slice(1);
  }
  // Straight apostrophe (U+0027) AND the curly right single quote (U+2019, what the source
  // spreadsheet actually uses for names like "O’loughlin" — confirmed by inspecting the raw
  // codepoint, not assumed) both need the following letter capitalized.
  return base.replace(/(['’])([a-z])/g, (_m, apos: string, c: string) => apos + c.toUpperCase());
}

/**
 * Cleans one real prospect's display name — two independent fixes, both from Tyler's own report:
 *
 * 1. **Strips a trailing parenthetical annotation** ("(NSW, Player ID 9120)"-shaped scrape junk) —
 *    defensive, see this file's top doc comment; a no-op against every name currently in this
 *    codebase, confirmed by direct audit before writing this function.
 * 2. **Fixes ONLY a word that is unambiguously wrong** — entirely lowercase, or ALL-CAPS (length >
 *    1, so a lone capitalized initial isn't touched either way). An already-mixed-case word (e.g.
 *    "Mcintosh", "El", "de" as an existing correct particle) is left completely alone: this script
 *    has no reliable way to verify a SPECIFIC real spelling beyond "this word was obviously never
 *    cased at all," and guessing further risks turning an already-correct name wrong (the classic
 *    "Macklin" -> "MacKlin" failure mode). This is deliberately narrower than a blind
 *    Title-Case-the-whole-string pass for exactly that reason.
 */
export function cleanProspectName(raw: string): string {
  let name = raw.trim();
  // eslint-disable-next-line no-constant-condition
  while (/\s*\([^)]*\)\s*$/.test(name)) {
    name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  const tokens = name.split(/(\s+|-)/); // keeps whitespace/hyphen separators so they round-trip untouched
  const fixed = tokens.map((tok) => {
    if (tok === "" || /^\s+$/.test(tok) || tok === "-") return tok;
    const isAllLower = tok === tok.toLowerCase() && tok !== tok.toUpperCase();
    const isAllUpper = tok === tok.toUpperCase() && tok !== tok.toLowerCase() && tok.length > 1;
    if (!isAllLower && !isAllUpper) return tok; // already mixed-case — leave alone, see doc comment
    if (LOWERCASE_NAME_PARTICLES.has(tok.toLowerCase())) return tok.toLowerCase();
    return titleCaseWord(tok);
  });
  return fixed.join("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const existing = JSON.parse(readFileSync(MASTER_PATH, "utf-8")) as RawRecord[];
  const newRows = JSON.parse(readFileSync(NEW_DATA_PATH, "utf-8")) as NewCommunityRecord[];
  console.log(`Read ${existing.length} existing real prospects, ${newRows.length} new community rows.`);

  // --- Fix 1: sweep every EXISTING record's name -----------------------------------------------
  let renamedCount = 0;
  const renameLog: string[] = [];
  const cleanedExisting = existing.map((r) => {
    const cleanedName = cleanProspectName(r.name);
    if (cleanedName !== r.name) {
      renamedCount++;
      renameLog.push(`${r.name} -> ${cleanedName}`);
      return { ...r, name: cleanedName, normName: cleanedName.toLowerCase() };
    }
    return r;
  });
  console.log(`\nFix 1 — renamed ${renamedCount} existing record(s):`);
  for (const line of renameLog) console.log(`  ${line}`);
  if (!renameLog.some((l) => l.startsWith("Khaled El souki"))) {
    throw new Error("Expected 'Khaled El souki' -> 'Khaled El Souki' in the rename log (realDraftPowerRankings.ts's own cross-reference depends on this) — got something else, check cleanProspectName");
  }

  // --- Fix 2: build new records from the community batch ---------------------------------------
  const ELIGIBLE_YEAR_BY_AGE_GROUP: Record<NewCommunityRecord["ageGroup"], number> = {
    U15: 2029,
    U16: 2028,
    "U17.5": 2027,
    U18: 2026,
  };
  const newRecords: RawRecord[] = newRows.map((row) => {
    const cleanedName = cleanProspectName(row.name);
    return {
      name: cleanedName,
      normName: cleanedName.toLowerCase(),
      team: row.team,
      positionRaw: null,
      heightCm: null,
      dob: null,
      writeups: [],
      standoutSourceEvents: [],
      standoutStats: null,
      gamesInStandout: 0,
      seasonStats: {
        gamesPlayed: row.gamesPlayed,
        goals: row.goals,
        bestCount: row.bestCount,
        mvpCount: 0,
        finalsPlayer: false,
        u18WcFinalsPlayer: false,
      },
      aflFutures: false,
      ageGroupSheet: row.ageGroup,
      sourceSheets: ["Community Footy"],
      homeState: "VIC",
    };
  });
  console.log(`\nFix 2 — built ${newRecords.length} new community records.`);
  const byAgeGroup = new Map<string, number>();
  for (const r of newRecords) byAgeGroup.set(r.ageGroupSheet!, (byAgeGroup.get(r.ageGroupSheet!) ?? 0) + 1);
  for (const [ag, n] of byAgeGroup) console.log(`  ${ag} -> eligible ${ELIGIBLE_YEAR_BY_AGE_GROUP[ag as NewCommunityRecord["ageGroup"]]}: ${n}`);

  // --- Identity-key collision check (mirrors buildRealProspects.ts's own hard-fail check) -------
  const allRecords = [...cleanedExisting, ...newRecords];
  const seenKeys = new Map<string, string>(); // key -> first record's name, for a readable error
  let collisions = 0;
  for (const r of allRecords) {
    const key = `${r.normName}::${r.team ?? ""}`;
    if (seenKeys.has(key)) {
      collisions++;
      console.error(`COLLISION: "${r.name}" @ "${r.team}" collides with "${seenKeys.get(key)}"`);
    } else {
      seenKeys.set(key, r.name);
    }
  }
  if (collisions > 0) {
    throw new Error(`${collisions} (normName, team) identity-key collision(s) found — aborting write, see COLLISION lines above`);
  }
  console.log(`\nIdentity-key check: ok, 0 collisions across ${allRecords.length} total records.`);

  writeFileSync(MASTER_PATH, JSON.stringify(allRecords, null, 2));
  console.log(`\nWrote ${allRecords.length} total real prospects -> ${MASTER_PATH}`);
}

main();
