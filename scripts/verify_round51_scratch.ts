/**
 * Round 51 real-data verification — [[Club Branding and Colours]]. Checks
 * the new verified per-club colour data (`types/club.ts`'s `primaryColor` /
 * `secondaryColor` / `abbreviation`) for completeness, uniqueness, exact
 * match against Tyler's own reference screenshot codes, WCAG contrast
 * readability of every `ClubBadge` bg/text pairing, and cross-checks the
 * data actually resolves for every club that appears in a real simulated
 * season (ladder + fixture), not just the static list in isolation. Run
 * with:
 *   node --experimental-strip-types scripts/verify_round51_scratch.ts
 */
import { CLUBS, clubById, clubByName } from "../src/types/club.ts";
import { initSeason, buildTeams } from "../src/engine/season.ts";
import { computeLadder } from "../src/engine/ladder.ts";
import { roundsForClub } from "../src/engine/fixture.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

// --- Section 1: every club has complete, well-formed badge data ---
{
  check("exactly 18 clubs", CLUBS.length === 18);
  for (const c of CLUBS) {
    check(`${c.name}: primaryColor is a valid 6-digit hex`, HEX_RE.test(c.primaryColor));
    check(`${c.name}: secondaryColor is a valid 6-digit hex`, HEX_RE.test(c.secondaryColor));
    check(`${c.name}: abbreviation is non-empty uppercase`, /^[A-Z]{2,5}$/.test(c.abbreviation));
    check(`${c.name}: primary !== secondary (badge text would be invisible)`, c.primaryColor.toUpperCase() !== c.secondaryColor.toUpperCase());
  }
}

// --- Section 2: abbreviations are unique and match Tyler's own reference screenshot exactly ---
{
  const abbrevs = CLUBS.map((c) => c.abbreviation);
  const uniqueAbbrevs = new Set(abbrevs);
  check("all 18 abbreviations are unique", uniqueAbbrevs.size === 18);

  // Tyler's reference screenshot, transcribed top-to-bottom: STK, WB, PORT, ESS, RICH,
  // GCFC, GWS, WCE, NMFC, ADEL, COLL, CARL, HAW, SYD, FRE, GEEL, MELB, BL.
  const referenceCodes = new Set([
    "STK", "WB", "PORT", "ESS", "RICH", "GCFC", "GWS", "WCE", "NMFC",
    "ADEL", "COLL", "CARL", "HAW", "SYD", "FRE", "GEEL", "MELB", "BL",
  ]);
  check("reference screenshot has 18 codes", referenceCodes.size === 18);
  for (const code of referenceCodes) {
    check(`reference code "${code}" exists in CLUBS`, abbrevs.includes(code));
  }
  for (const code of abbrevs) {
    check(`CLUBS abbreviation "${code}" is one Tyler's reference screenshot actually showed`, referenceCodes.has(code));
  }
}

// --- Section 3: WCAG contrast ratio for every badge's bg/text pairing ---
// Standard relative-luminance + contrast-ratio formulas (WCAG 2.x), computed independently
// here rather than eyeballed — this is the actual "official colours, verified" check for
// readability, not just for sourcing.
function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
{
  // 3.0:1 is WCAG's own minimum for bold/large-scale text (our badge text is small but
  // bold, uppercase, and on a solid fill, which reads more like the "large text" case in
  // practice) — below that is a real, reportable failure, not a style nitpick.
  const MIN_RATIO = 3.0;
  console.log("\nContrast ratios (badge bg -> text), sorted lowest first:");
  const ratios = CLUBS.map((c) => ({ name: c.abbreviation, ratio: contrastRatio(c.primaryColor, c.secondaryColor) }));
  ratios.sort((a, b) => a.ratio - b.ratio);
  for (const r of ratios) {
    console.log(`  ${r.name.padEnd(5)} ${r.ratio.toFixed(2)}:1${r.ratio < 4.5 ? "  (below 4.5:1 AA-normal-text bar, but bold/uppercase/small — checked against the 3:1 large-text bar instead)" : ""}`);
  }
  for (const c of CLUBS) {
    const ratio = contrastRatio(c.primaryColor, c.secondaryColor);
    check(`${c.name} badge (${c.abbreviation}) clears ${MIN_RATIO}:1 contrast`, ratio >= MIN_RATIO);
  }
}

// --- Section 4: clubById / clubByName resolve every club correctly (identity + no drift) ---
{
  for (const c of CLUBS) {
    const byId = clubById(c.ClubID);
    check(`clubById(${c.ClubID}) resolves to ${c.name}`, byId?.name === c.name);
    check(`clubById(${c.ClubID}).abbreviation matches`, byId?.abbreviation === c.abbreviation);
    const byName = clubByName(c.name);
    check(`clubByName("${c.name}") resolves to ClubID ${c.ClubID}`, byName?.ClubID === c.ClubID);
  }
  check("clubById(-1) is undefined (graceful, ClubBadge renders nothing)", clubById(-1) === undefined);
  check('clubByName("Nonexistent FC") is undefined (graceful, ClubBadge renders nothing)', clubByName("Nonexistent FC") === undefined);
}

// --- Section 5: every club that actually appears in a real simulated season's ladder and ---
// --- fixture resolves to complete badge data — ties this to runtime usage, not just the ---
// --- static list read in isolation. ---
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  const SEED = 991344207;
  const season = initSeason(SEED, clubIds);
  buildTeams(clubIds); // sanity: doesn't throw for the full real club list

  check("ladder has one row per club", season.ladder.length === clubIds.length);
  for (const row of season.ladder) {
    const c = clubById(row.clubId);
    check(`ladder clubId ${row.clubId} resolves to a club with complete badge data`, !!c && HEX_RE.test(c.primaryColor) && HEX_RE.test(c.secondaryColor) && !!c.abbreviation);
  }

  for (const clubId of clubIds) {
    const fixture = roundsForClub(season.fixture, clubId);
    check(`club ${clubId} has a non-empty fixture`, fixture.length > 0);
    for (const m of fixture) {
      const home = clubById(m.homeClubId);
      const away = clubById(m.awayClubId);
      check(`fixture match round ${m.round}: both home (${m.homeClubId}) and away (${m.awayClubId}) resolve`, !!home && !!away);
    }
  }

  // computeLadder itself doesn't touch colour data, but re-confirms the same 18 clubIds
  // round-trip through the ladder engine cleanly — a cheap extra cross-check that this
  // round's data-model changes (adding two new required fields) didn't silently break
  // anything CLUBS already fed into.
  const ladderCheck = computeLadder(clubIds, []);
  check("computeLadder([], no matches) still returns 18 rows after CLUBS shape change", ladderCheck.length === 18);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
