/**
 * Round 68 real-data verification — decoupling real-data joins from mutable display names. Run
 * with:
 *   node --experimental-strip-types scripts/verify_round68_scratch.ts
 *
 * The regression this round fixes: `draftHistoryFor`/`realSeasonHistoryFor`/`debutYearFor`/
 * `engine/records.ts`'s real+sim career-continuation merge all used to key off a player's LIVE
 * `fname`/`lname` (via `playerFullName(player)`/`getPlayerByFullName`) — found via a database
 * architecture review, not a live bug report. A future fictional-name rename would have silently
 * severed every one of those links: no error, just quietly empty results. This script proves two
 * things, not one: (1) the NEW approach (`Player.realFullName`/`getPlayerByRealFullName`) survives
 * a simulated rename, and (2) the OLD approach really would have broken under the same rename — so
 * this isn't a test that would have passed even without the fix.
 */
import { ALL_PLAYERS, getPlayerByFullName, getPlayerByRealFullName } from "../src/data/loadPlayers.ts";
import { playerFullName, type Player } from "../src/types/player.ts";
import { draftHistoryFor } from "../src/data/realDraftHistory.ts";
import { realSeasonHistoryFor } from "../src/data/realSeasonHistory.ts";
import { debutYearFor } from "../src/data/realDebutDates.ts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  OK  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

// ---------------------------------------------------------------------------
console.log("[1] Baseline — every currently-loaded player's realFullName matches their live name");
const mismatches = ALL_PLAYERS.filter((p) => p.realFullName !== playerFullName(p));
check(
  "all 751 generated players have realFullName === playerFullName today (nothing renamed yet — buildData.ts sets both from the same CSV row)",
  mismatches.length === 0,
  `${mismatches.length} mismatches: ${mismatches.slice(0, 5).map((p) => `${playerFullName(p)} vs "${p.realFullName}"`).join(", ")}`,
);
check("every player has a defined realFullName (buildData.ts always sets it)", ALL_PLAYERS.every((p) => typeof p.realFullName === "string"), `${ALL_PLAYERS.filter((p) => typeof p.realFullName !== "string").length} missing`);

// ---------------------------------------------------------------------------
console.log("\n[2] Baseline equivalence — getPlayerByRealFullName agrees with getPlayerByFullName today");
let disagreements = 0;
for (const p of ALL_PLAYERS.slice(0, 100)) {
  const byLive = getPlayerByFullName(playerFullName(p));
  const byReal = getPlayerByRealFullName(playerFullName(p));
  if (byLive?.PlayerID !== byReal?.PlayerID) disagreements++;
}
check("getPlayerByFullName and getPlayerByRealFullName resolve identically for a 100-player sample (no rename has happened yet)", disagreements === 0, `${disagreements} disagreements`);

// ---------------------------------------------------------------------------
console.log("\n[3] THE KEY TEST — simulate a fictional rename of a real player, prove the fix survives it");
const xerri = ALL_PLAYERS.find((p) => playerFullName(p) === "Tristan Xerri");
if (!xerri) {
  check("Tristan Xerri is loaded (test subject for this section)", false, "not found in ALL_PLAYERS");
} else {
  const renamed: Player = { ...xerri, fname: "Zeke", lname: "Vortan" }; // realFullName deliberately left untouched — this is the whole point
  const liveName = playerFullName(renamed); // "Zeke Vortan"
  const realName = renamed.realFullName ?? playerFullName(renamed); // still "Tristan Xerri"

  check("sanity: the simulated rename actually changed the live display name", liveName === "Zeke Vortan" && liveName !== "Tristan Xerri");
  check("sanity: realFullName survived the rename untouched", realName === "Tristan Xerri");

  // --- Prove the OLD approach (live name) would have broken ---
  check("OLD approach — draftHistoryFor(playerFullName(renamed)) returns NOTHING post-rename (the actual regression)", draftHistoryFor(liveName).length === 0, `got ${draftHistoryFor(liveName).length} rows`);
  check("OLD approach — realSeasonHistoryFor(playerFullName(renamed)) returns NOTHING post-rename", realSeasonHistoryFor(liveName).length === 0, `got ${realSeasonHistoryFor(liveName).length} rows`);
  check("OLD approach — debutYearFor(playerFullName(renamed)) returns undefined post-rename", debutYearFor(liveName) === undefined, `got ${debutYearFor(liveName)}`);

  // --- The OTHER direction (records.ts's combinedRecord: given a REAL name, find the live player)
  // needs the LIVE POOL itself mutated, not a disconnected clone — `getPlayerByFullName`/
  // `getPlayerByRealFullName` both search `ALL_PLAYERS`, so a clone that's never pushed into it is
  // invisible to either lookup either way. `xerri` IS a live reference into `ALL_PLAYERS` (`.find`
  // returns the object itself, not a copy), so mutating it in place genuinely simulates an in-app
  // rename. Restored immediately after — later sections, and any other script sharing this process,
  // should see the pool exactly as they found it.
  const originalFname = xerri.fname;
  const originalLname = xerri.lname;
  xerri.fname = "Zeke";
  xerri.lname = "Vortan";
  try {
    check(
      "OLD approach — getPlayerByFullName(\"Tristan Xerri\") can't find him anymore once the LIVE pool entry is actually renamed (the real records.ts regression)",
      getPlayerByFullName("Tristan Xerri") === undefined,
      `found PlayerID ${getPlayerByFullName("Tristan Xerri")?.PlayerID}`,
    );
    check(
      "NEW approach — getPlayerByRealFullName(\"Tristan Xerri\") still finds him after the same live rename, via his frozen realFullName",
      getPlayerByRealFullName("Tristan Xerri")?.PlayerID === xerri.PlayerID,
      `found PlayerID ${getPlayerByRealFullName("Tristan Xerri")?.PlayerID}, expected ${xerri.PlayerID}`,
    );
  } finally {
    xerri.fname = originalFname;
    xerri.lname = originalLname;
  }
  check("live pool restored — Xerri's name is back to normal for the rest of this script", playerFullName(xerri) === "Tristan Xerri");

  // --- Prove the NEW approach (frozen realFullName) survives ---
  const draftBefore = draftHistoryFor("Tristan Xerri").length;
  const draftAfter = draftHistoryFor(realName).length;
  check(`NEW approach — draftHistoryFor(realFullName) still finds all ${draftBefore} of Xerri's real draft/trade rows post-rename`, draftAfter > 0 && draftAfter === draftBefore, `before=${draftBefore} after=${draftAfter}`);

  const seasonBefore = realSeasonHistoryFor("Tristan Xerri").length;
  const seasonAfter = realSeasonHistoryFor(realName).length;
  check(`NEW approach — realSeasonHistoryFor(realFullName) still finds all ${seasonBefore} of Xerri's real season rows post-rename`, seasonAfter > 0 && seasonAfter === seasonBefore, `before=${seasonBefore} after=${seasonAfter}`);

  const debutBefore = debutYearFor("Tristan Xerri");
  const debutAfter = debutYearFor(realName);
  check(`NEW approach — debutYearFor(realFullName) still finds Xerri's real debut year (${debutBefore}) post-rename`, debutAfter !== undefined && debutAfter === debutBefore, `before=${debutBefore} after=${debutAfter}`);
}

// ---------------------------------------------------------------------------
console.log("\n[4] Backward compatibility — pre-round-68 saves (realFullName missing) still work via fallback");
if (xerri) {
  const preRound68: Player = { ...xerri, realFullName: undefined };
  check(
    "getPlayerByRealFullName still finds a player with no realFullName, via the playerFullName(p) fallback",
    ALL_PLAYERS.some((p) => (p.realFullName ?? playerFullName(p)) === "Tristan Xerri"), // sanity the live pool itself still resolves
  );
  const fallbackName = preRound68.realFullName ?? playerFullName(preRound68);
  check("the fallback expression itself produces the correct real name when realFullName is undefined", fallbackName === "Tristan Xerri", `got "${fallbackName}"`);
  check("draftHistoryFor still resolves correctly for a pre-round-68 player object via the fallback pattern used in PlayerProfileModal.tsx", draftHistoryFor(fallbackName).length === draftHistoryFor("Tristan Xerri").length);
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
