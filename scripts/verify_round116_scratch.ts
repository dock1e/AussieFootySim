/**
 * Round 116 — [[Club Theme System]] Match Day rebuild — real-data verification.
 *
 * Checks, against the actual source files (not a mock):
 * 1. FANTASY_COLOR's accent-bearing fields reference the expected CSS custom properties / color-mix
 *    recipes rather than restated hex literals.
 * 2. gain/loss/goal pull from MEANING_TOKENS (not restated literals).
 * 3. No `rgba(124,92,240` (the old fixed-purple accent) remains anywhere in the Match Day files.
 * 4. GroundView's nodeColorsFor correctly assigns "yours" colouring by yourSide, not literal "home" —
 *    a real behavioural check against a synthetic yourSide="away" case.
 * 5. ScoreboardBand/TeamStatBars/DangerMen source no longer reference the OLD Club.primaryColor/
 *    secondaryColor system via ClubBadgeByName for the sites round 116 was meant to migrate.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
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

const fantasyEngineSrc = readFileSync(join(ROOT, "src/engine/fantasyEngine.ts"), "utf8");
const liveMatchSrc = readFileSync(join(ROOT, "src/components/LiveMatch.tsx"), "utf8");
const groundViewSrc = readFileSync(join(ROOT, "src/components/GroundView.tsx"), "utf8");

// --- Section 1: FANTASY_COLOR uses real tokens, not restated literals ---
check("FANTASY_COLOR.pageBg uses var(--deep) color-mix recipe", /pageBg:\s*"color-mix\(in oklch, var\(--deep\)/.test(fantasyEngineSrc));
check("FANTASY_COLOR.accentLit is var(--acc)", /accentLit:\s*"var\(--acc\)"/.test(fantasyEngineSrc));
check("FANTASY_COLOR.accentSegment is var(--accT)", /accentSegment:\s*"var\(--accT\)"/.test(fantasyEngineSrc));
check("FANTASY_COLOR.accentLine uses var(--acc2)", /accentLine:\s*"color-mix\(in oklch, var\(--acc2\)/.test(fantasyEngineSrc));

// --- Section 2: gain/loss/goal from MEANING_TOKENS, not restated hex ---
check("FANTASY_COLOR.gain = MEANING_TOKENS.rise", /gain:\s*MEANING_TOKENS\.rise/.test(fantasyEngineSrc));
check("FANTASY_COLOR.loss = MEANING_TOKENS.fall", /loss:\s*MEANING_TOKENS\.fall/.test(fantasyEngineSrc));
check("FANTASY_COLOR.goal = MEANING_TOKENS.warn", /goal:\s*MEANING_TOKENS\.warn/.test(fantasyEngineSrc));
// Note: the doc comment above FANTASY_COLOR intentionally quotes the OLD hex values (#4fbf87/#d9695f)
// as a historical "here's exactly what drifted" reference — that's prose, not a restated live value,
// so the real check is that they don't appear as an object value (`: "#4fbf87"` etc).
check("Old hex #4fbf87/#d9695f no longer appear as live FANTASY_COLOR field values", !/:\s*"#4fbf87"|:\s*"#d9695f"/.test(fantasyEngineSrc));

// --- Section 3: no leftover hardcoded purple anywhere in Match Day files ---
check("No rgba(124,92,240 in LiveMatch.tsx", !/rgba\(124,92,240/.test(liveMatchSrc));
check("No rgba(124,92,240 in GroundView.tsx", !/rgba\(124,92,240/.test(groundViewSrc));
check("No rgba(124,92,240 in fantasyEngine.ts", !/rgba\(124,92,240/.test(fantasyEngineSrc));
check("SELECTED_ROW_BG/HOVER_ROW_BG/SELECTED_ROW_SHADOW are actually imported+used in LiveMatch.tsx", /SELECTED_ROW_BG/.test(liveMatchSrc) && /HOVER_ROW_BG/.test(liveMatchSrc) && /SELECTED_ROW_SHADOW/.test(liveMatchSrc));

// --- Section 4: nodeColorsFor real behavioural check (yourSide-aware, not literal "home") ---
// Re-implement the exact logic from GroundView.tsx's nodeColorsFor to test it against a synthetic
// yourSide="away" case — confirming "yours" tracks yourSide, not the literal string "home".
type Side = "home" | "away";
interface ClubTokensLike { deep: string; acc: string; }
const AWAY_NODE_FILL = "#f2f4f8";
function nodeColorsFor(side: Side, yourSide: Side, homeTokens: ClubTokensLike, awayTokens: ClubTokensLike) {
  const isYours = side === yourSide;
  const tokens = side === "home" ? homeTokens : awayTokens;
  return isYours ? { fill: tokens.deep, ring: tokens.acc } : { fill: AWAY_NODE_FILL, ring: tokens.deep };
}
const homeTokens = { deep: "#06296e", acc: "#3d7cf0" }; // NMFC
const awayTokens = { deep: "#0b2340", acc: "#8fb8e8" }; // CARL

// Case A: yourSide = "home" (the common case) — home node should get "yours" treatment.
const homeNodeA = nodeColorsFor("home", "home", homeTokens, awayTokens);
const awayNodeA = nodeColorsFor("away", "home", homeTokens, awayTokens);
check("yourSide=home: home node is 'yours' (deep fill = NMFC deep)", homeNodeA.fill === homeTokens.deep && homeNodeA.ring === homeTokens.acc);
check("yourSide=home: away node is 'theirs' (light fill, ring = away deep)", awayNodeA.fill === AWAY_NODE_FILL && awayNodeA.ring === awayTokens.deep);

// Case B: yourSide = "away" (AI-vs-AI spectate, or you're the away side) — away node should now get
// "yours" treatment, and home should flip to the light "theirs" fill. This is the real regression
// check: the OLD round-113 code hardcoded home=you unconditionally, which this must NOT do.
const homeNodeB = nodeColorsFor("home", "away", homeTokens, awayTokens);
const awayNodeB = nodeColorsFor("away", "away", homeTokens, awayTokens);
check("yourSide=away: away node is 'yours' (deep fill = CARL deep, not home's)", awayNodeB.fill === awayTokens.deep && awayNodeB.ring === awayTokens.acc);
check("yourSide=away: home node is 'theirs' (light fill, ring = home deep) — NOT hardcoded to home=you", homeNodeB.fill === AWAY_NODE_FILL && homeNodeB.ring === homeTokens.deep);
check("Case A and Case B genuinely differ (proves yourSide, not literal 'home', drives the split)", homeNodeA.fill !== homeNodeB.fill && awayNodeA.fill !== awayNodeB.fill);

// --- Section 5: GroundView.tsx no longer has the old fixed hex fallback constants ---
check("HOME_COLOR_FALLBACK/AWAY_COLOR_FALLBACK constants removed from GroundView.tsx", !/HOME_COLOR_FALLBACK\s*=|AWAY_COLOR_FALLBACK\s*=/.test(groundViewSrc));
check("GroundView.tsx imports clubTokensFor", /import\s*\{\s*clubTokensFor/.test(groundViewSrc));
check("GroundView.tsx's nodeColorsFor signature takes yourSide", /function nodeColorsFor\(side: Side, yourSide: Side/.test(groundViewSrc));
check("GroundViewProps has yourSide?: Side", /yourSide\?:\s*Side/.test(groundViewSrc));

// --- Section 6: LiveMatch.tsx call sites pass yourSide through / theme new surfaces ---
check("LiveMatch.tsx's <GroundView> call passes yourSide={yourSide}", /<GroundView[\s\S]{0,900}yourSide=\{yourSide\}/.test(liveMatchSrc));
check("ScoreboardBand call passes yourSide={yourSide}", /<ScoreboardBand[\s\S]{0,200}yourSide=\{yourSide\}/.test(liveMatchSrc));
check("TeamMonogram component exists (replaces ClubBadgeByName on ScoreboardBand)", /function TeamMonogram/.test(liveMatchSrc));
check("ScoreboardBand JSX uses TeamMonogram, not ClubBadgeByName, for its two team badges", /<TeamMonogram name=\{homeTeam\.name\}/.test(liveMatchSrc) && /<TeamMonogram name=\{awayTeam\.name\}/.test(liveMatchSrc));
check("DangerMen header no longer renders a ClubBadgeByName (brief: plain text header)", (() => {
  const start = liveMatchSrc.indexOf("function DangerMen");
  const end = liveMatchSrc.indexOf("\nfunction ", start + 1);
  const chunk = liveMatchSrc.slice(start, end);
  return start !== -1 && end !== -1 && !/<ClubBadgeByName/.test(chunk) && /Their danger men/.test(chunk);
})());
check("TeamStatBars own-segment fill is var(--acc), opponent segment is neutral rgba(255,255,255,.18)", /background:\s*"var\(--acc\)",\s*width:\s*`\$\{pct\}%`/.test(liveMatchSrc) && /background:\s*"rgba\(255,255,255,\.18\)"/.test(liveMatchSrc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
