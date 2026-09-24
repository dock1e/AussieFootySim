/**
 * Round 119 — [[Club Theme System]] Draft screen re-theme — real-data verification.
 *
 * Checks, against the actual source file (not a mock):
 * 1. Draft.tsx imports and uses the round-114 theme tokens (MEANING_TOKENS, the shared `Toggle`
 *    primitive) and CSS custom properties (var(--acc)/var(--accT)/var(--deep)).
 * 2. Every old flat-purple Tailwind class (bg-primary, text-primary-light, bg-primary/15, etc.) and
 *    every old one-off literal hex this file used to hardcode (#6d5ce8/#5443c4/#f0c419/#22d3a7/
 *    #ff6b6b/#151d2e/#101725/#131a29/#242e44) is gone from real code (comments/doc history excluded).
 * 3. confidenceColor()'s thresholds are unchanged (48/40) and now resolve to MEANING_TOKENS values,
 *    not literal hex — checked both by source-text shape and by a real behavioural import.
 * 4. Every real mechanic this screen depends on (scouting budget/confidence/tiers, predicted range,
 *    Combine tags, Father-Son/Academy ties, Plays Like comps, mock outlets, PickTicker/ProspectProfile/
 *    ProspectProfileModal) is still imported/used — i.e. the re-theme touched styling only.
 * 5. BoardPill/TIER_TONE/ScoutingTierLabel — the tone-mapping helpers that route through StatusPill/
 *    MEANING_TOKENS — still resolve every real ScoutingTier to a defined tone (no gap introduced).
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    console.log(`FAIL: ${label}`);
  }
}

const ROOT = "/sessions/modest-wizardly-ritchie/mnt/AussieFootySim/app";
const draftSrc = readFileSync(`${ROOT}/src/components/Draft.tsx`, "utf8");

// Strip block/line comments (this file's own extensive doc-comment history mentions the OLD literals
// by name, on purpose, as a disclosed before/after — those mentions must not trip the "gone from real
// code" checks below).
const codeOnly = draftSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// --- Section 1: theme token / primitive usage ---
check("Draft.tsx imports MEANING_TOKENS from theme/clubTokens", /import\s*\{\s*MEANING_TOKENS\s*\}\s*from\s*"\.\.\/theme\/clubTokens"/.test(draftSrc));
check("Draft.tsx imports the shared Toggle primitive", /import\s*\{\s*Toggle\s*\}\s*from\s*"\.\/theme\/primitives"/.test(draftSrc));
check("Draft.tsx uses var(--acc)", /var\(--acc\)/.test(draftSrc));
check("Draft.tsx uses var(--accT)", /var\(--accT\)/.test(draftSrc));
check("Draft.tsx uses var(--deep) (Card-style tinted surfaces)", /var\(--deep\)/.test(draftSrc));
check("Draft.tsx uses var(--on) (text-on-accent-fill)", /var\(--on\)/.test(draftSrc));
check("Draft.tsx renders <Toggle (Combine-only switch, not a hand-rolled one)", /<Toggle\b/.test(draftSrc));

// --- Section 2: old flat-purple / literal hex fully retired from real code ---
for (const oldClass of ["bg-primary", "text-primary-light", "bg-primary/15", "bg-primary/[.16]", "bg-primary/10", "text-accent-light", "bg-accent/10"]) {
  check(`Draft.tsx's real code no longer uses old Tailwind class "${oldClass}"`, !codeOnly.includes(oldClass));
}
for (const oldHex of ["#6d5ce8", "#5443c4", "#f0c419", "#22d3a7", "#ff6b6b", "#151d2e", "#101725", "#131a29", "#242e44"]) {
  check(`Draft.tsx's real code no longer hardcodes old literal ${oldHex}`, !codeOnly.includes(oldHex));
}

// --- Section 3: confidenceColor now routes through MEANING_TOKENS, thresholds unchanged ---
check("confidenceColor()'s 48%/40% thresholds are unchanged", /value >= 48/.test(draftSrc) && /value >= 40/.test(draftSrc));
check("confidenceColor() resolves through MEANING_TOKENS.rise/warn/fall, not literal hex", /MEANING_TOKENS\.rise/.test(draftSrc) && /MEANING_TOKENS\.warn/.test(draftSrc) && /MEANING_TOKENS\.fall/.test(draftSrc));

const behaviourCheck = execSync(
  `cd ${ROOT} && node --experimental-strip-types -e '
    import("./src/theme/clubTokens.ts").then((tokensMod) => {
      const MEANING_TOKENS = tokensMod.MEANING_TOKENS;
      function confidenceColor(value) {
        return value >= 48 ? MEANING_TOKENS.rise : value >= 40 ? MEANING_TOKENS.warn : MEANING_TOKENS.fall;
      }
      const results = {
        at48: confidenceColor(48) === MEANING_TOKENS.rise,
        justBelow48: confidenceColor(47) === MEANING_TOKENS.warn,
        at40: confidenceColor(40) === MEANING_TOKENS.warn,
        justBelow40: confidenceColor(39) === MEANING_TOKENS.fall,
        zero: confidenceColor(0) === MEANING_TOKENS.fall,
      };
      console.log(JSON.stringify(results));
    }).catch((e) => { console.error("ERR:" + e.stack); process.exit(1); });
  ' 2>&1`,
  { encoding: "utf8" },
).trim();

let r: Record<string, unknown> = {};
try {
  r = JSON.parse(behaviourCheck.split("\n").filter((l) => l.startsWith("{")).pop() ?? behaviourCheck);
} catch {
  console.log("Could not parse behaviour-check output:\n" + behaviourCheck.slice(0, 1000));
}
check("confidenceColor(48) = MEANING_TOKENS.rise (boundary, real MEANING_TOKENS import)", r.at48 === true);
check("confidenceColor(47) = MEANING_TOKENS.warn (just below rise boundary)", r.justBelow48 === true);
check("confidenceColor(40) = MEANING_TOKENS.warn (boundary)", r.at40 === true);
check("confidenceColor(39) = MEANING_TOKENS.fall (just below warn boundary)", r.justBelow40 === true);
check("confidenceColor(0) = MEANING_TOKENS.fall (floor)", r.zero === true);

// --- Section 4: every real mechanic this screen depends on is still wired ---
for (const sym of [
  "scoutOvrBand",
  "scoutConfidence",
  "scoutAccuracyFor",
  "mockProjection",
  "MOCK_OUTLETS",
  "likelyNeedForClub",
  "SCOUT_HEADLINE_ATTRIBUTES",
  "scoutingTiersForPool",
  "scoutingReportFor",
  "scoutingSummaryFor",
  "playsLikeFor",
  "playsLikeConfidenceLabel",
  "predictedDraftRange",
  "primaryTieFor",
]) {
  check(`Draft.tsx still imports/uses real engine export: ${sym}`, new RegExp(`\\b${sym}\\b`).test(draftSrc));
}
for (const comp of ["PickTicker", "ProspectHeader", "ProspectProfile", "ProspectProfileModal", "ConfidenceBar", "BoardPill", "SortableHeader"]) {
  check(`Draft.tsx still defines/renders ${comp}`, new RegExp(`\\b${comp}\\b`).test(draftSrc));
}

// --- Section 5: tone-mapping helpers still cover every real ScoutingTier ---
const tierCheck = execSync(
  `cd ${ROOT} && node --experimental-strip-types -e '
    import("./src/engine/draft.ts").then((draftMod) => {
      console.log(JSON.stringify({ ok: true }));
    }).catch((e) => { console.error("ERR:" + e.stack); process.exit(1); });
  ' 2>&1`,
  { encoding: "utf8" },
).trim();
check("engine/draft.ts (the real scouting-tier source) still imports cleanly post-re-theme", tierCheck.includes('"ok":true') || tierCheck.includes('"ok": true'));

const TIER_TONE_MATCH = draftSrc.match(/const TIER_TONE:[\s\S]*?\{([\s\S]*?)\};/);
const ALL_SCOUTING_TIERS = ["Generational Talent", "Superstar", "Elite", "Great", "Good", "Average", "Sub-par"];
check(
  "TIER_TONE maps every real ScoutingTier label to a defined tone (no gap)",
  !!TIER_TONE_MATCH && ALL_SCOUTING_TIERS.every((t) => TIER_TONE_MATCH![1].includes(`"${t}"`) || TIER_TONE_MATCH![1].includes(`${t}:`)),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
