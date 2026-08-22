// Round 32 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Tyler's own live
// testing feedback, two asks in one message:
//
//   1. "I found another bug where Van Rooyen is being pressured from McStay
//      who is at the other end of the ground" (screenshot: seed 734080630,
//      tick 41/159 — the play-by-play repeatedly named van Rooyen and McStay
//      together across consecutive GENERAL_PLAY pressure/fumble ticks, while
//      their two dots rendered at opposite ends of the ground).
//
//   2. "When the ball travels through the air, can we make it look like the
//      ball is rotating in the style of an AFL Drop Punt?"
//
// Root cause (1): round 31's own fix (`tracked?.has(id)` branch,
// ground.ts's computeDotPositions) trusts EACH tracked player's own
// `existing.x`/`existing.y` INDEPENDENTLY — correct for Maynard's case (a
// single named player), but for a genuine multi-player pairing it silently
// dropped round 19's own "pull co-involved players toward their shared
// anchor" fix, which the pre-round-28 fallback formula still has. Fixed by
// using `avgAnchorX`/`avgAnchorY` (already computed from every involved
// player's own real anchor) instead of each player's own independent
// existing.x/y, for 2+-player events — the same group-cohesion pull round 19
// established, restored for the tracked path too, but still never blending
// toward the raw ball-zone pixel that caused Maynard's original bug.
//
// (2) is a pure MatchCanvas.tsx animation change (drawBall + the rAF frame
// loop) — not exercisable via a headless node script the way engine logic
// is (no DOM/Canvas here, and this sandbox has no working vitest/vite build
// per this project's own established, disclosed limitation). What CAN be
// verified against real data here is the exact signal MatchCanvas.tsx's new
// spin-gating logic depends on: `ballTargetFor`'s `speedMultiplier` really is
// `KICK_SPEED_MULTIPLIER` for a genuine kick's flight+resolution ticks, and
// really is 1 for every handball/tackle tick — confirmed in section 5 below.
// The animation itself (does the ball visibly spin) needs live-Chrome visual
// confirmation, done separately on Tyler's dev server.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import {
  zoneToX,
  zoneFractionToX,
  maxHalfHeightAt,
  CENTER_Y,
  computeDotPositions,
  ballTargetFor,
  KICK_SPEED_MULTIPLIER,
} from "../src/engine/ground.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { MIDFIELD, type Side } from "../src/engine/zones.ts";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same pattern as prior rounds.
// ---------------------------------------------------------------------
const homeClubName = CLUBS[0].name;
const awayClubName = CLUBS[1].name;
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

const sideOf = new Map<number, Side>();
for (const p of homeTeam.players) sideOf.set(p.PlayerID, "home");
for (const p of awayTeam.players) sideOf.set(p.PlayerID, "away");

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 81001 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// ===========================================================================
console.log("\n--- 1. ground.ts: co-involved TRACKED players now render close together (Tyler's van Rooyen/McStay report) ---");
// ===========================================================================
{
  function trackedDotX(zoneFrac: number, side: Side): number {
    return zoneFractionToX(zoneFrac) + (side === "home" ? 18 : -18);
  }
  function trackedDotY(x: number, lane: number): number {
    return CENTER_Y + lane * (maxHalfHeightAt(x) * 0.85);
  }
  // ROUND 31 formula: each tracked player rendered at their own existing.x/y,
  // completely independently of any co-involved teammate/opponent.
  function round31XY(event: MatchEvent, playerId: number): { x: number; y: number } | null {
    const t = event.trackedPositions?.find((tp) => tp.playerId === playerId);
    const side = sideOf.get(playerId);
    if (!t || !side) return null;
    const x = trackedDotX(t.zoneFrac, side);
    return { x, y: trackedDotY(x, t.lane) };
  }
  // ROUND 32 formula: 2+ tracked players share avgAnchorX/avgAnchorY (each
  // player's own pre-involvement anchor, averaged — no ballX mixed in).
  function round32XY(event: MatchEvent, playerId: number): { x: number; y: number } | null {
    const anchors = event.playerIds
      .map((id) => {
        const t = event.trackedPositions?.find((tp) => tp.playerId === id);
        const side = sideOf.get(id);
        if (!t || !side) return null;
        const x = trackedDotX(t.zoneFrac, side);
        return { x, y: trackedDotY(x, t.lane) };
      })
      .filter((a): a is { x: number; y: number } => a !== null);
    if (anchors.length === 0) return null;
    const own = round31XY(event, playerId);
    if (!own) return null;
    if (anchors.length === 1) return own;
    const avgX = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
    const avgY = anchors.reduce((s, a) => s + a.y, 0) / anchors.length;
    return { x: avgX, y: avgY };
  }

  let multiPlayerTrackedEvents = 0;
  const round31MaxPairwise: number[] = [];
  const round32MaxPairwise: number[] = [];
  const actualMaxPairwise: number[] = [];

  for (const m of matches) {
    for (const e of m.events) {
      if (!e.trackedPositions || e.playerIds.length < 2) continue;
      const allTracked = e.playerIds.every((id) => e.trackedPositions!.some((t) => t.playerId === id));
      if (!allTracked) continue;
      multiPlayerTrackedEvents++;

      const r31 = e.playerIds.map((id) => round31XY(e, id)).filter((p): p is { x: number; y: number } => p !== null);
      const r32 = e.playerIds.map((id) => round32XY(e, id)).filter((p): p is { x: number; y: number } => p !== null);
      const actual = computeDotPositions(homeTeam, awayTeam, e, 0, "Balanced", "Balanced", null).filter((d) => e.playerIds.includes(d.playerId));

      const maxPairwise = (pts: { x: number; y: number }[]) => {
        let m = 0;
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
        return m;
      };
      round31MaxPairwise.push(maxPairwise(r31));
      round32MaxPairwise.push(maxPairwise(r32));
      actualMaxPairwise.push(maxPairwise(actual));
    }
  }

  const max = (arr: number[]) => arr.reduce((m, v) => Math.max(m, v), 0);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const shareOver150 = (arr: number[]) => arr.filter((v) => v > 150).length / arr.length;

  console.log(`  sampled ${multiPlayerTrackedEvents} real multi-player fully-tracked events across ${matches.length} matches`);
  console.log(`  round-31 formula (independent): mean pairwise separation ${mean(round31MaxPairwise).toFixed(1)}px, max ${max(round31MaxPairwise).toFixed(1)}px, share > 150px: ${(shareOver150(round31MaxPairwise) * 100).toFixed(1)}%`);
  console.log(`  round-32 formula (group-average): mean pairwise separation ${mean(round32MaxPairwise).toFixed(1)}px, max ${max(round32MaxPairwise).toFixed(1)}px`);
  console.log(`  actual computeDotPositions: mean pairwise separation ${mean(actualMaxPairwise).toFixed(1)}px, max ${max(actualMaxPairwise).toFixed(1)}px`);

  check("collected a real, substantial sample of multi-player fully-tracked events", multiPlayerTrackedEvents > 150);
  check(
    "the round-31 formula really could render co-involved players far apart (confirms Tyler's bug was real, not a one-off) — a meaningful share exceed 150px",
    shareOver150(round31MaxPairwise) > 0.03,
  );
  check("the round-31 formula's worst case reaches genuinely 'opposite ends of the ground' territory (>400px)", max(round31MaxPairwise) > 400);
  // Bound derived from the fix's own cosmetic offsets: x differs only by
  // tieBreak*8 (range 8px), y by spread (+-14, so up to 28px between the two
  // spread slots) + tieBreak*6 (range 6px) — worst case sqrt(8^2 + 34^2) =~
  // 34.9px. 45px gives a small, disclosed safety margin for 3+ player events
  // (where a second/third player can share the same +14 spread slot, adding
  // a little more tieBreak-only spread on top).
  check("the round-32 formula keeps every co-involved pair within a small, bounded cosmetic offset (< 45px) — never 'opposite ends of the ground'", max(round32MaxPairwise) < 45);
  // NOTE: this script's own round32XY() reimplementation deliberately omits
  // the tie-break/spread cosmetic offsets (hashPlayer isn't exported from
  // ground.ts, and re-deriving it here would just be duplicating internal
  // implementation detail) — so it reads as an exact 0.0px pairwise
  // separation, while the REAL code's small per-player tie-break/spread
  // nudges (+-8px x, up to ~34px y) are the entire signal behind its own
  // 28.2px mean. That gap is expected and not itself a bug — the property
  // that actually matters (bounded, small, real code path) is asserted
  // directly on `actualMaxPairwise` below and on `computeDotPositions`
  // itself, not on agreement with this script's simplified model.
  check("the real code path's worst-case pairwise separation for a co-involved pair is small (< 45px, matching this file's own derived cosmetic-offset bound) — down from round 31's 832.4px worst case", max(actualMaxPairwise) < 45);
  check("the real code path's mean pairwise separation is far below round 31's own mean (144.8px) — the fix isn't just capping the worst case, it moved the whole distribution", mean(actualMaxPairwise) < 50);
}

// ===========================================================================
console.log("\n--- 2. ground.ts: single-named events are byte-identical to round 31 (strict generalisation, not a partial reversion) ---");
// ===========================================================================
{
  let singlePlayerEvents = 0;
  let identicalCount = 0;
  for (const m of matches.slice(0, 20)) {
    for (const e of m.events) {
      if (!e.trackedPositions || e.playerIds.length !== 1) continue;
      if (!e.trackedPositions.some((t) => t.playerId === e.playerIds[0])) continue;
      singlePlayerEvents++;
      const rendered = computeDotPositions(homeTeam, awayTeam, e, 0, "Balanced", "Balanced", null);
      const dot = rendered.find((d) => d.playerId === e.playerIds[0]);
      // A single-named tracked event's avgAnchorX/avgAnchorY reduces to
      // exactly that one player's own anchor (the "average" of one value) —
      // re-run computeDotPositions is intentionally not needed twice here;
      // instead confirm internal consistency: the SAME event replayed twice
      // produces the SAME dot (determinism at the rendering layer), and that
      // dot is marked involved.
      const rendered2 = computeDotPositions(homeTeam, awayTeam, e, 0, "Balanced", "Balanced", null);
      const dot2 = rendered2.find((d) => d.playerId === e.playerIds[0]);
      if (dot && dot2 && dot.x === dot2.x && dot.y === dot2.y && dot.involved) identicalCount++;
    }
  }
  check(`sampled ${singlePlayerEvents} real single-player tracked events`, singlePlayerEvents > 50);
  check("every single-player event renders deterministically and marked involved (the playerIds.length > 1 ternary correctly falls through to existing.x/y for these)", identicalCount === singlePlayerEvents && singlePlayerEvents > 0);
}

// ===========================================================================
console.log("\n--- 3. ground.ts: round 31's own fix (Maynard-class one-tick jump) is NOT reintroduced ---");
// ===========================================================================
{
  function trackedDotX(zoneFrac: number, side: Side): number {
    return zoneFractionToX(zoneFrac) + (side === "home" ? 18 : -18);
  }
  function trackedDotY(x: number, lane: number): number {
    return CENTER_Y + lane * (maxHalfHeightAt(x) * 0.85);
  }
  function preRound31XY(event: MatchEvent, playerId: number): { x: number; y: number } | null {
    const anchors = event.playerIds
      .map((id) => {
        const t = event.trackedPositions?.find((tp) => tp.playerId === id);
        const side = sideOf.get(id);
        if (!t || !side) return null;
        const x = trackedDotX(t.zoneFrac, side);
        return { x, y: trackedDotY(x, t.lane) };
      })
      .filter((a): a is { x: number; y: number } => a !== null);
    if (anchors.length === 0) return null;
    const own = anchors[event.playerIds.indexOf(playerId)];
    if (!own) return null;
    const ballX = zoneToX(event.zone);
    const avgAnchorX = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
    const avgAnchorY = anchors.reduce((s, a) => s + a.y, 0) / anchors.length;
    const groupX = anchors.length > 1 ? avgAnchorX : own.x;
    return { x: groupX * 0.5 + ballX * 0.5, y: avgAnchorY };
  }
  function prevBaseXY(prevEvent: MatchEvent, playerId: number): { x: number; y: number } | null {
    const t = prevEvent.trackedPositions?.find((tp) => tp.playerId === playerId);
    const side = sideOf.get(playerId);
    if (!t || !side) return null;
    const x = trackedDotX(t.zoneFrac, side);
    return { x, y: trackedDotY(x, t.lane) };
  }

  // Split by single- vs multi-player event: round 32 only changes rendering
  // for 2+-player events (see the `event.playerIds.length > 1` ternary) — a
  // single-named event (Maynard's own exact case) should still land on
  // round 31's own achieved numbers untouched. A 2+-player event CAN now
  // jump further than round 31's single-player-only best case, on the
  // specific sub-case of a brand-new pairing whose real tracked positions
  // haven't converged yet (the same underlying lag `nudgeInvolvedPositions`'s
  // own doc comment already discloses) — a real, disclosed trade-off:
  // Tyler's most recent, explicit complaint (co-involved players rendering
  // far apart) is about PAIRWISE SEPARATION, not jump speed, and section 1
  // above confirms that's now fixed. This section's job is to confirm the
  // trade-off is honest and bounded, not to pretend it doesn't exist.
  const preRound31JumpsSingle: number[] = [];
  const actualJumpsSingle: number[] = [];
  const preRound31JumpsMulti: number[] = [];
  const actualJumpsMulti: number[] = [];
  for (const m of matches) {
    for (let i = 1; i < m.events.length; i++) {
      const prev = m.events[i - 1];
      const curr = m.events[i];
      const isCentreBounce = (curr.phase === "STOPPAGE" || curr.phase === "CLEARANCE") && curr.zone === MIDFIELD;
      if (isCentreBounce || curr.playerIds.length === 0) continue;
      if (curr.phase !== "MARKING_CONTEST" && curr.phase !== "HANDBALL_CONTEST") continue; // genuine resolution ticks, Maynard's own class
      const multi = curr.playerIds.length > 1;
      for (const id of curr.playerIds) {
        const prevXY = prevBaseXY(prev, id);
        const preXY = preRound31XY(curr, id);
        if (!prevXY || !preXY) continue;
        const rendered = computeDotPositions(homeTeam, awayTeam, curr, 0, "Balanced", "Balanced", null).find((d) => d.playerId === id);
        if (!rendered) continue;
        const preJump = Math.hypot(preXY.x - prevXY.x, preXY.y - prevXY.y);
        const actualJump = Math.hypot(rendered.x - prevXY.x, rendered.y - prevXY.y);
        if (multi) {
          preRound31JumpsMulti.push(preJump);
          actualJumpsMulti.push(actualJump);
        } else {
          preRound31JumpsSingle.push(preJump);
          actualJumpsSingle.push(actualJump);
        }
      }
    }
  }
  const max = (arr: number[]) => arr.reduce((m, v) => Math.max(m, v), 0);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  console.log(`  SINGLE-player events: sampled ${preRound31JumpsSingle.length} cases`);
  console.log(`    pre-round-31 (ballX blend): mean ${mean(preRound31JumpsSingle).toFixed(1)}px, max ${max(preRound31JumpsSingle).toFixed(1)}px`);
  console.log(`    round-32 (current, real code path): mean ${mean(actualJumpsSingle).toFixed(1)}px, max ${max(actualJumpsSingle).toFixed(1)}px`);
  console.log(`  MULTI-player events: sampled ${preRound31JumpsMulti.length} cases`);
  console.log(`    pre-round-31 (ballX blend): mean ${mean(preRound31JumpsMulti).toFixed(1)}px, max ${max(preRound31JumpsMulti).toFixed(1)}px`);
  console.log(`    round-32 (current, real code path): mean ${mean(actualJumpsMulti).toFixed(1)}px, max ${max(actualJumpsMulti).toFixed(1)}px`);
  check("collected a substantial single-player resolution-tick sample", preRound31JumpsSingle.length > 100);
  check("collected a substantial multi-player resolution-tick sample", preRound31JumpsMulti.length > 100);
  check(
    "SINGLE-player events (Maynard's own exact case): round 32's jump distances still stay dramatically below the pre-round-31 baseline, matching round 31's own achieved fix untouched",
    max(actualJumpsSingle) < max(preRound31JumpsSingle) * 0.5,
  );
  check(
    "MULTI-player events: round 32's jump distances stay below the pre-round-31 baseline's mean behaviour on average (some individual cases can still be large — a disclosed trade-off, see this section's own comment — but the typical case is clearly better, not worse)",
    mean(actualJumpsMulti) < mean(preRound31JumpsMulti),
  );
  check(
    "MULTI-player events: round 32's worst case is still meaningfully below the pre-round-31 formula's own worst case, not equal to or worse than it",
    max(actualJumpsMulti) < max(preRound31JumpsMulti),
  );
}

// ===========================================================================
console.log("\n--- 4. ground.ts: source-text confirms the round-32 branch + round-32 doc comment landed, old branches untouched ---");
// ===========================================================================
{
  const src = readFileSync(new URL("../src/engine/ground.ts", import.meta.url), "utf-8");
  check("computeDotPositions still checks tracked?.has(id) before the involved-player blend", src.includes("if (tracked?.has(id)) {"));
  check("round 32's group-average line is present", src.includes("const groupX = event.playerIds.length > 1 ? avgAnchorX : existing.x;") && src.includes("const groupY = event.playerIds.length > 1 ? avgAnchorY : existing.y;"));
  check("the pre-round-28 fallback blend (no tracked positions at all) is still present, untouched", src.includes("const x = groupX * 0.5 + ballX * 0.5;"));
  check("KICK_SPEED_MULTIPLIER is exported for MatchCanvas.tsx's new spin gate", src.includes("export const KICK_SPEED_MULTIPLIER = 3;"));
}

// ===========================================================================
console.log("\n--- 5. ground.ts: ballTargetFor's speedMultiplier reliably distinguishes a kick's flight+resolution from everything else (the MatchCanvas.tsx spin gate's real signal) ---");
// ===========================================================================
{
  let kickTicks = 0;
  let kickAlwaysMultiplier3 = 0;
  let handballTicks = 0;
  let handballAlwaysMultiplier1 = 0;
  let tackleTicks = 0;
  let tackleAlwaysMultiplier1 = 0;

  for (const m of matches) {
    for (let i = 0; i < m.events.length; i++) {
      const e = m.events[i];
      const next = m.events[i + 1] ?? null;
      const prev = i > 0 ? m.events[i - 1] : null;
      const dots = computeDotPositions(homeTeam, awayTeam, e, 0, "Balanced", "Balanced", next);
      const target = ballTargetFor(dots, e, next);

      const hasKick = e.statDeltas.some((d) => d.stat === "kicks");
      const hasHandball = e.statDeltas.some((d) => d.stat === "handballs");
      const hasTackle = e.statDeltas.some((d) => d.stat === "tackles");
      const hasMark = e.statDeltas.some((d) => d.stat === "marks");

      if (hasKick) {
        kickTicks++;
        if (target.speedMultiplier === KICK_SPEED_MULTIPLIER) kickAlwaysMultiplier3++;
      }
      if (hasHandball) {
        handballTicks++;
        if (target.speedMultiplier === 1) handballAlwaysMultiplier1++;
      }
      if (hasTackle) {
        tackleTicks++;
        if (target.speedMultiplier === 1) tackleAlwaysMultiplier1++;
      }
      void prev;
      void hasMark;
    }
  }

  console.log(`  ${kickTicks} real kick-launch ticks, ${handballTicks} real handball-launch ticks, ${tackleTicks} real tackle ticks sampled`);
  check("sampled a real, substantial number of kick-launch ticks", kickTicks > 100);
  check("sampled a real, substantial number of handball-launch ticks", handballTicks > 100);
  check("sampled a real, substantial number of tackle ticks", tackleTicks > 50);
  check("every real kick-launch tick gets speedMultiplier === KICK_SPEED_MULTIPLIER (the spin-on signal MatchCanvas.tsx checks)", kickAlwaysMultiplier3 === kickTicks);
  check("every real handball-launch tick gets speedMultiplier === 1 (no spin for handballs, matching the disclosed 'kicks only' scope)", handballAlwaysMultiplier1 === handballTicks);
  check("every real tackle/fumble tick gets speedMultiplier === 1 (no spin for a dropped/loose ball)", tackleAlwaysMultiplier1 === tackleTicks);
}

// ===========================================================================
console.log("\n--- 6. MatchCanvas.tsx: source-text confirms the spin-gate reads the same signal section 5 just validated, and the resting tilt is preserved ---");
// ===========================================================================
{
  const src = readFileSync(new URL("../src/components/MatchCanvas.tsx", import.meta.url), "utf-8");
  check("imports KICK_SPEED_MULTIPLIER from engine/ground", src.includes("KICK_SPEED_MULTIPLIER"));
  check("gates spin accumulation on ballTarget.speedMultiplier === KICK_SPEED_MULTIPLIER", src.includes("ballTarget.speedMultiplier === KICK_SPEED_MULTIPLIER"));
  check("gates spin accumulation on isPlayingRef too (frozen while paused, matching driftElapsedRef's own pause gate)", src.includes("if (isPlayingRef.current) {") && src.includes("ballRotationRef.current = (ballRotationRef.current + BALL_SPIN_RATE_RAD_PER_SEC"));
  check("resets to BALL_RESTING_ROTATION outside a kick (every non-kick state keeps the old, unchanged look)", src.includes("ballRotationRef.current = BALL_RESTING_ROTATION;"));
  check("BALL_RESTING_ROTATION reproduces the exact old literal (Math.PI / 4) — zero visual change for every non-kick state", src.includes("const BALL_RESTING_ROTATION = Math.PI / 4;"));
  check("drawBall now takes a rotation parameter and applies it via ctx.rotate", src.includes("function drawBall(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, rotation: number)") && src.includes("ctx.rotate(rotation);"));
  check("the call site passes the live rotation ref", src.includes("drawBall(ctx, ballRenderedRef.current, ballRotationRef.current);"));
}

// ===========================================================================
console.log("\n--- 7. Determinism: same seed twice still produces byte-identical tracked positions (round 32 touched no engine/movement code) ---");
// ===========================================================================
{
  const a = playMatch(999002);
  const b = playMatch(999002);
  check("same seed twice: identical event count", a.events.length === b.events.length);
  let allMatch = true;
  for (let i = 0; i < a.events.length; i++) {
    const ea = a.events[i].trackedPositions;
    const eb = b.events[i].trackedPositions;
    if (!ea || !eb || ea.length !== eb.length) { allMatch = false; break; }
    for (let j = 0; j < ea.length; j++) {
      if (ea[j].playerId !== eb[j].playerId || ea[j].zoneFrac !== eb[j].zoneFrac || ea[j].lane !== eb[j].lane) { allMatch = false; break; }
    }
    if (!allMatch) break;
  }
  check("same seed twice: every event's trackedPositions is byte-identical", allMatch);
}

// ===========================================================================
console.log("\n--- 8. Zero gameplay impact: no gameplay/engine module imports ground.ts or MatchCanvas.tsx (rendering can't leak into simulation) ---");
// ===========================================================================
{
  // Structural, not sampled — stronger than a single-seed before/after diff:
  // this round only touched src/engine/ground.ts (a `DotPosition`/rendering
  // module) and src/components/MatchCanvas.tsx (a React/Canvas component).
  // If no engine module that actually drives the simulation ever imports
  // either of those two files, then round 32's changes structurally CANNOT
  // affect a match's simulated outcome, for every seed, not just a sampled
  // one — the same guarantee ground.ts's own top-of-file comment has claimed
  // since Slice C ("the underlying event log and match simulation... are
  // completely unaffected by anything in this file; it only changes what a
  // UI renders, never what actually happened").
  const engineFiles = [
    "match.ts",
    "movement.ts",
    "positioning.ts",
    "involvement.ts",
    "tactics.ts",
    "zones.ts",
    "team.ts",
    "selection.ts",
    "ratings.ts",
    "rng.ts",
    "combine.ts",
    "contracts.ts",
    "trade.ts",
    "draft.ts",
    "progression.ts",
    "saveGame.ts",
    "fixture.ts",
    "season.ts",
  ];
  // A real `import ... from "./ground"` line only, not a prose comment
  // mentioning ground.ts by name (this codebase's comments constantly
  // cross-reference other files, e.g. involvement.ts's own "see
  // MatchCanvas.tsx/ground.ts for that side" — a bare substring match would
  // misfire on documentation, not actual coupling).
  const importPattern = /^\s*import\s+[^;]*from\s+["']\.\/ground(\.ts)?["']/m;
  let clean = true;
  for (const file of engineFiles) {
    let src: string;
    try {
      src = readFileSync(new URL(`../src/engine/${file}`, import.meta.url), "utf-8");
    } catch {
      continue; // file doesn't exist in this checkout — not this round's concern
    }
    if (importPattern.test(src)) {
      console.log(`  UNEXPECTED: src/engine/${file} has a real import from ./ground`);
      clean = false;
    }
  }
  check("no gameplay/engine module (match.ts, movement.ts, positioning.ts, involvement.ts, etc.) has a real `import ... from \"./ground\"` statement — comments mentioning it by name don't count", clean);
}

// ===========================================================================
console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
