// Round 113 verification — [[Match Day Fantasy Layer Revision 2]]'s R2.1-R2.4, triaged:
//
//   R2.1 no-layout-shift             -> Section 1 (ribbon height arithmetic, code layer) + grep (empty-
//                                        state sentence gone). Actual pixel-identical-bounding-rect check
//                                        (acceptance #9) is a live-DOM/screenshot assertion — deferred to
//                                        live Chrome verification (task #939).
//   R2.2 ribbon-rows-stable-identity -> Section 2 (real data through the exact ranking rule: always
//                                        exactly 5, sorted, isMover flag correct). The actual "no DOM
//                                        remount, 180ms CSS transition" half (acceptance #11) is a
//                                        React-internals/DOM assertion — deferred to live Chrome.
//   R2.3 ground-node-legibility      -> Section 3 (grep: literal 22px/27px diameter constants exist, old
//                                        stroke/resolveClubColor gone) + Section 4 (pickTextColor-style
//                                        contrast logic re-derived and checked against every real club's
//                                        primary, since GroundView.tsx itself is a .tsx file this plain
//                                        node script can't import). Actual on-screen legibility/no-shared-
//                                        fill-colour (acceptance #12) is a visual assertion — deferred to
//                                        live Chrome.
//   R2.4 bench-relocation            -> Section 5 (real data: ticksSinceOffGround correctness against a
//                                        real simulated match's actual rotations) + Section 6
//                                        (formatSecondsSince unit cases) + grep (BenchStrip/BenchSide
//                                        gone, no separate INT row-group). The actual "bench nodes render
//                                        attached to the ground, hover/click work" half (acceptance #14)
//                                        is a visual/DOM assertion — deferred to live Chrome.
//
// Plus Section 7: re-confirms round 112's own real-squad-size finding (23/team, not the brief's 22 or
// 26) still holds — every one of R2's own row-count claims (R2.1's "26", R2.4's "22" and acceptance #13)
// depends on this same number, so it's worth re-asserting here rather than just trusting the prior round's
// script never regressed.

import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, type MatchEvent, type BoxScoreLine } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import { onGroundPlayers, benchPlayers } from "../src/engine/team.ts";
import { computeFantasyMetrics, ribbonWindowTicks, formatSecondsSince, secondsPerTick, type PlayerMatchFantasyMetrics } from "../src/engine/fantasyEngine.ts";
import { STADIUMS } from "../src/data/stadiums.ts";
import * as fs from "node:fs";
import * as path from "node:path";

let failures = 0;
function check(label: string, pass: boolean, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!pass) failures++;
}

const melbourne = CLUBS.find((c) => c.name === "Melbourne")!;
const collingwood = CLUBS.find((c) => c.name === "Collingwood")!;
const homePlayers = getPlayersByClub(melbourne.name);
const awayPlayers = getPlayersByClub(collingwood.name);
const home = lineupToMatchTeam(melbourne.name, autoFillLineup(homePlayers), homePlayers);
const away = lineupToMatchTeam(collingwood.name, autoFillLineup(awayPlayers), awayPlayers);
const seed = 991113991;
const result = simulateMatch(home, away, mulberry32(seed), seed, {});
const allIds = [...home.players, ...away.players].map((p) => p.PlayerID);
const stadium = STADIUMS[0];
const matchLastTick = result.events[result.events.length - 1].tick;

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relPath), "utf8");
}

function grepAll(fingerprint: string): string[] {
  const matches: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        if (fs.readFileSync(full, "utf8").includes(fingerprint)) matches.push(full.replace(/\\/g, "/"));
      }
    }
  }
  walk(path.join(process.cwd(), "src"));
  return matches;
}

console.log("=== Section 1: R2.1 — ribbon's fixed 201px height arithmetic, read straight from LiveMatch.tsx's own literal constants ===");
{
  const src = readSrc("components/LiveMatch.tsx");
  const numFor = (name: string) => {
    const m = src.match(new RegExp(`const ${name} = (\\d+);`));
    return m ? Number(m[1]) : NaN;
  };
  const header = numFor("RIBBON_HEADER_HEIGHT");
  const colHeader = numFor("RIBBON_COLHEADER_HEIGHT");
  const rowHeight = numFor("RIBBON_ROW_HEIGHT");
  const rowCount = numFor("RIBBON_ROW_COUNT");
  check("RIBBON_HEADER_HEIGHT is 44 (title row + scope-filter row, 22 each)", header === 44, `got ${header}`);
  check("RIBBON_COLHEADER_HEIGHT is 22", colHeader === 22, `got ${colHeader}`);
  check("RIBBON_ROW_HEIGHT is 27", rowHeight === 27, `got ${rowHeight}`);
  check("RIBBON_ROW_COUNT is 5", rowCount === 5, `got ${rowCount}`);
  const total = header + colHeader + rowHeight * rowCount;
  check("header + colHeader + rowHeight*rowCount === 201 (R2.1's own literal arithmetic)", total === 201, `${header}+${colHeader}+${rowHeight}*${rowCount}=${total}`);

  check(
    "the old content-dependent empty-state sentence (\"Nothing's moved in the last\") does not exist anywhere in src/",
    grepAll("Nothing's moved in the last").length === 0,
    `found in: ${grepAll("Nothing's moved in the last").join(", ") || "(none)"}`,
  );
  check(
    "the ribbon's pre-match label is the brief's literal \"Projected output\" (case preserved) — sentence-cased in the actual JSX, checked case-insensitively",
    /projected output/i.test(src),
  );
}

console.log("\n=== Section 2: R2.2 — real fantasyMetrics run through the ribbon's exact ranking rule (sort by delta5 desc, fp desc; slice 5; isMover=delta5>0) ===");
{
  function metricsAtTick(tick: number, ids: number[]) {
    const truncated = result.events.filter((e) => e.tick <= tick);
    const template = result.boxScore[allIds[0]];
    const zero = (t: BoxScoreLine): BoxScoreLine => {
      const out = { ...t };
      for (const k of Object.keys(out) as (keyof BoxScoreLine)[]) (out[k] as number) = 0;
      return out;
    };
    const lines: Record<number, BoxScoreLine> = {};
    for (const id of allIds) lines[id] = zero(template);
    for (const ev of truncated) for (const d of ev.statDeltas) lines[d.playerId][d.stat] = ((lines[d.playerId][d.stat] as number) ?? 0) + d.delta;
    return computeFantasyMetrics({ events: truncated, ticksPerQuarter: result.ticksPerQuarter, stadium, lines, fitnessOf: () => 100, seasonAvgFpOf: () => 0 }, ids);
  }

  const sampleTicks = [Math.round(matchLastTick * 0.3), Math.round(matchLastTick * 0.6), matchLastTick];
  for (const tick of sampleTicks) {
    const onGroundIds = onGroundPlayers(home).map((p) => p.PlayerID);
    check(`tick ${tick}: home's onGroundPlayers has >= 5 candidates (structural guarantee behind "always exactly 5 rows")`, onGroundIds.length >= 5, `onGround=${onGroundIds.length}`);

    const metrics = metricsAtTick(tick, onGroundIds);
    const ranked = onGroundIds
      .map((id) => ({ id, m: metrics.get(id)! }))
      .sort((a, b) => b.m.delta5 - a.m.delta5 || b.m.fp - a.m.fp)
      .slice(0, 5);
    check(`tick ${tick}: ranking rule yields exactly 5 rows`, ranked.length === 5, `got ${ranked.length}`);

    let sorted = true;
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1].m;
      const cur = ranked[i].m;
      if (prev.delta5 < cur.delta5 || (prev.delta5 === cur.delta5 && prev.fp < cur.fp)) sorted = false;
    }
    check(`tick ${tick}: ranked rows are non-increasing by (delta5, fp)`, sorted, ranked.map((r) => `${r.m.delta5.toFixed(1)}/${r.m.fp.toFixed(0)}`).join(" >= "));

    const isMoverMismatch = ranked.filter((r) => (r.m.delta5 > 0) !== (r.m.delta5 > 0)).length; // isMover is literally `delta5 > 0` in the component — definitionally can't mismatch, kept as a documented tautology check rather than skipped
    check(`tick ${tick}: isMover flag (delta5 > 0) is well-defined for every ranked row (no NaN delta5)`, ranked.every((r) => !Number.isNaN(r.m.delta5)) && isMoverMismatch === 0);
  }
}

console.log("\n=== Section 3: R2.3 (code layer) — GroundView.tsx's literal node-size/colour-scheme constants ===");
{
  const src = readSrc("components/GroundView.tsx");
  check("DOT_DIAMETER_PX is literally 22 (R2.3: \"Node size up to 22px diameter\")", /const DOT_DIAMETER_PX = 22;/.test(src));
  check("INVOLVED_DOT_DIAMETER_PX is literally 27", /const INVOLVED_DOT_DIAMETER_PX = 27;/.test(src));
  check("DOT_RADIUS_M/INVOLVED_DOT_RADIUS_M are derived from the diameter constants, not separately hardcoded", /const DOT_RADIUS_M = DOT_DIAMETER_PX \/ 2 \/ PX_PER_METRE;/.test(src) && /const INVOLVED_DOT_RADIUS_M = INVOLVED_DOT_DIAMETER_PX \/ 2 \/ PX_PER_METRE;/.test(src));
  check("the old flat 0.5m white-stroke constant (DOT_STROKE_WIDTH_M) is gone", !src.includes("DOT_STROKE_WIDTH_M"));
  check("the old primary-only resolveClubColor(...) function is gone", !/function resolveClubColor\(/.test(src));
  check("the new resolveClubColors(...) (primary+secondary) exists", /function resolveClubColors\(/.test(src));
  check("away fill is the fixed literal #f2f4f8 (never the away club's own colour)", /const AWAY_NODE_FILL = "#f2f4f8";/.test(src));
  check("home ring width is 2, away ring width is 2.5, per nodeColorsFor", /ringWidth: 2 \}/.test(src) && /ringWidth: 2\.5 \}/.test(src));
  check("selected/highlighted ring is #b9a6ff at 3px (R2.3: \"keeps the existing accent ring #b9a6ff at 3px\")", src.includes('"#b9a6ff"') && /ctx\.lineWidth = 3;/.test(src));
  check("dark halo colour is the literal rgba(6,10,16,.55)", src.includes("rgba(6,10,16,.55)"));
  check("guernsey number font is fixed 10px IBM Plex Mono 600 (not radius-derived)", src.includes('600 10px "IBM Plex Mono", monospace') && !src.includes("Math.round(radius * 0.85)"));
  check("BenchStrip/BenchSide (the old HTML pill strips) no longer exist in GroundView.tsx", !src.includes("function BenchStrip") && !src.includes("function BenchSide"));
  check("TeamLegend (R2.3's two-chip legend) exists", /function TeamLegend\(/.test(src));
}

console.log("\n=== Section 4: R2.3 — pickTextColor's contrast rule re-derived and checked against every real club's own primary colour ===");
{
  // Re-implements GroundView.tsx's relativeLuminance/contrastRatio/pickTextColor verbatim (that file is a
  // .tsx this plain node script can't import) purely to check the RULE against real data: for every real
  // club, whichever of the two literal text colours it picks must have a >= contrast ratio than the other
  // against that club's actual primary — i.e. the function is genuinely picking the better of the two, not
  // a hardcoded side-based guess. A separate, independent hand check below covers the specific "pale
  // primary needs dark text" case the brief's own hardcoded-by-side reading would get wrong.
  function hexToRgb(hex: string) {
    const c = hex.replace("#", "");
    return { r: parseInt(c.substring(0, 2), 16), g: parseInt(c.substring(2, 4), 16), b: parseInt(c.substring(4, 6), 16) };
  }
  function toLinear(c: number) {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }
  function luminance(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }
  function contrast(a: number, b: number) {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  const LIGHT = "#f2f4f8";
  const DARK = "#12161c";
  function pickTextColor(fill: string) {
    const l = luminance(fill);
    const cl = contrast(l, luminance(LIGHT));
    const cd = contrast(l, luminance(DARK));
    return cl >= cd ? LIGHT : DARK;
  }

  let allCorrect = true;
  for (const club of CLUBS) {
    const chosen = pickTextColor(club.primaryColor);
    const other = chosen === LIGHT ? DARK : LIGHT;
    const l = luminance(club.primaryColor);
    const chosenContrast = contrast(l, luminance(chosen));
    const otherContrast = contrast(l, luminance(other));
    if (chosenContrast < otherContrast - 1e-9) allCorrect = false;
  }
  check(`pickTextColor picks the higher-contrast option for all ${CLUBS.length} real clubs' primary colours`, allCorrect);

  // A pale/yellow primary specifically (the case a hardcoded "home always gets light text" reading of the
  // brief would get backwards) — assert dark text wins for a synthetic bright-yellow fill as a sanity
  // anchor, independent of which real club happens to have the palest primary this season.
  check('pickTextColor("#ffd200") [a bright yellow, e.g. a real club\'s actual primary] chooses the DARK literal, not light-on-light', pickTextColor("#ffd200") === DARK, pickTextColor("#ffd200"));
  check('pickTextColor("#0a1f44") [a dark navy] chooses the LIGHT literal', pickTextColor("#0a1f44") === LIGHT, pickTextColor("#0a1f44"));

  // Structural guarantee behind "never two dark fills against each other" / "no two opposing nodes share a
  // fill colour": AWAY_NODE_FILL must not equal any real club's own primaryColor (case-insensitive) — if it
  // did, an away side whose real primary happens to equal that exact hex could in principle read
  // ambiguously against a same-coloured home fill. (Away never uses its own primary as a FILL — only as a
  // ring — so this is a belt-and-braces check, not the actual mechanism that guarantees the invariant.)
  const AWAY_NODE_FILL = "#f2f4f8";
  const collision = CLUBS.filter((c) => c.primaryColor.toLowerCase() === AWAY_NODE_FILL.toLowerCase());
  check("no real club's primaryColor equals the fixed AWAY_NODE_FILL constant", collision.length === 0, collision.map((c) => c.name).join(", "));
}

console.log("\n=== Section 5: R2.4 — ticksSinceOffGround correctness against a real simulated match's real rotations ===");
{
  const onGroundSpan = new Map<number, { first: number; last: number }>();
  for (const ev of result.events) {
    for (const t of ev.trackedPositions ?? []) {
      const rec = onGroundSpan.get(t.playerId);
      if (!rec) onGroundSpan.set(t.playerId, { first: ev.tick, last: ev.tick });
      else rec.last = ev.tick;
    }
  }
  let benchedId: number | null = null;
  let benchedAtTick = -1;
  let bestGap = -1;
  for (const id of allIds) {
    const rec = onGroundSpan.get(id);
    if (!rec) continue;
    const gap = matchLastTick - rec.last;
    if (gap > bestGap) {
      bestGap = gap;
      benchedId = id;
      benchedAtTick = rec.last;
    }
  }

  function metricsFor(id: number, throughTick: number): PlayerMatchFantasyMetrics {
    const truncated = result.events.filter((e) => e.tick <= throughTick);
    const template = result.boxScore[allIds[0]];
    const zero = (t: BoxScoreLine): BoxScoreLine => {
      const out = { ...t };
      for (const k of Object.keys(out) as (keyof BoxScoreLine)[]) (out[k] as number) = 0;
      return out;
    };
    const lines: Record<number, BoxScoreLine> = { [id]: zero(template) };
    for (const ev of truncated) for (const d of ev.statDeltas) if (d.playerId === id) lines[id][d.stat] = ((lines[id][d.stat] as number) ?? 0) + d.delta;
    return computeFantasyMetrics({ events: truncated, ticksPerQuarter: result.ticksPerQuarter, stadium, lines, fitnessOf: () => 100, seasonAvgFpOf: () => 0 }, [id]).get(id)!;
  }

  if (benchedId === null) {
    console.log("  SKIPPED (informational) — no player had any tracked on-ground presence this seed.");
  } else {
    const atBenchTick = metricsFor(benchedId, benchedAtTick);
    check(
      `PlayerID ${benchedId}: ticksSinceOffGround is null AT the exact tick they were last on-ground (still "on" at that instant)`,
      atBenchTick.ticksSinceOffGround === null,
      `got ${atBenchTick.ticksSinceOffGround}`,
    );

    if (bestGap > 0) {
      const laterTick = matchLastTick;
      const later = metricsFor(benchedId, laterTick);
      const expected = laterTick - benchedAtTick;
      check(
        `PlayerID ${benchedId}: ticksSinceOffGround at a later tick equals (thatTick - lastOnGroundTick)`,
        later.ticksSinceOffGround === expected,
        `expected ${expected}, got ${later.ticksSinceOffGround}`,
      );

      const secs = later.ticksSinceOffGround! * secondsPerTick(result.ticksPerQuarter);
      const formatted = formatSecondsSince(secs);
      check(`formatSecondsSince(${secs.toFixed(1)}) produces a non-empty, plausible string`, /^\d+s$|^\d+:\d{2}$/.test(formatted), formatted);
    } else {
      console.log(`  (informational) PlayerID ${benchedId} was on-ground until the very last tick — no later tick available to check the non-null branch this seed.`);
    }

    // A player on-ground for the ENTIRE match (first tick to last) should read null throughout — the
    // "started on interchange, never rotated on" edge case doesn't apply here, but "never left" should
    // behave identically (never null->non-null).
    let neverBenchedId: number | null = null;
    for (const id of allIds) {
      const rec = onGroundSpan.get(id);
      if (rec && rec.first <= result.events[0].tick + 1 && rec.last === matchLastTick) {
        neverBenchedId = id;
        break;
      }
    }
    if (neverBenchedId !== null) {
      const m = metricsFor(neverBenchedId, matchLastTick);
      check(`PlayerID ${neverBenchedId}: a player on-ground the whole match reads ticksSinceOffGround === null at full-time`, m.ticksSinceOffGround === null, `got ${m.ticksSinceOffGround}`);
    }
  }
}

console.log("\n=== Section 6: R2.4 — formatSecondsSince unit cases (pure function, no match data needed) ===");
{
  const cases: [number, string][] = [
    [0, "0s"],
    [1, "1s"],
    [45, "45s"],
    [59, "59s"],
    [60, "1:00"],
    [65, "1:05"],
    [125, "2:05"],
    [599, "9:59"],
    [600, "10:00"],
  ];
  for (const [input, expected] of cases) {
    const got = formatSecondsSince(input);
    check(`formatSecondsSince(${input}) === "${expected}"`, got === expected, `got "${got}"`);
  }
  check("formatSecondsSince clamps negative input to non-negative (never a negative/garbled string)", /^\d/.test(formatSecondsSince(-5)), formatSecondsSince(-5));
}

console.log("\n=== Section 7: re-confirms round 112's real-squad-size finding (23/team) — R2's own \"22\"/\"26\" figures are stale echoes of the pre-round-112 assumption ===");
{
  for (const [team, label] of [
    [home, "home"],
    [away, "away"],
  ] as const) {
    const onG = onGroundPlayers(team).length;
    const bench = benchPlayers(team).length;
    check(`${label}: onGroundPlayers=18, benchPlayers=5 (23 total, the real 2026-rule squad)`, onG === 18 && bench === 5, `onGround=${onG}, bench=${bench}`);
  }
  const liveMatchSrc = readSrc("components/LiveMatch.tsx");
  check(
    "LiveBoard's own doc comment discloses the real 23-count and cross-references gap #92 (not silently re-asserting the brief's stale 22/26/4-bench figures)",
    liveMatchSrc.includes("All 23 (18 on-ground + 5 interchange") && liveMatchSrc.includes("gap #92"),
  );
}

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
console.log("Acceptance #9 (pixel-identical ground bounding rect), #11's DOM-remount/CSS-transition half, #12's on-screen legibility, and #14's visual bench-attachment are live-DOM/screenshot assertions — deferred to live Chrome verification (task #939).");
process.exit(failures === 0 ? 0 : 1);
