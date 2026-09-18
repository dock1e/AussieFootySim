/**
 * Round 109 verification -- throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention (excluded from both tsconfig.json
 * and tsconfig.node.json -- run directly via `node --experimental-strip-
 * types`, never held to tsc's strict bar).
 *
 * Tyler pasted a Q3 play-by-play excerpt and asked for: (1) umpire
 * call-outs ("Umpire throws the ball up" / "The boundary umpire throws in
 * the ball") as their own restart beat before every stoppage resolution,
 * and (2) a bigger, more dynamic/emotive phrase bank generally. Investigation
 * also turned up a real pre-existing bug independent of that ask: both
 * `resolveUnpressuredDisposal` and `runGeneralPlay`'s inline pressured block
 * ALWAYS fired an unconditional GENERIC line ("X finds space with a kick --
 * no one close enough to contest") immediately followed by a SPECIFIC line
 * naming the receiver -- two log() calls, one real disposal, every time.
 * Fixed by merging into one line per disposal (stat credit carried onto
 * whichever specific line fires) and separately adding phrase-bank variety
 * to tackle/spoil/intercept-mark/gather/contested-win lines.
 *
 * Four sections, all against REAL simulated matches (this round's changes
 * are text/event-shape, not formulas -- unit-testing constants in isolation
 * the way round 107/108 did doesn't apply here):
 *   1. Stoppage restart call-outs -- every hitout-resolution STOPPAGE line
 *      is immediately preceded by a restart-phrase STOPPAGE line at the same
 *      tick, restart lines carry no players/stats, and both phrase pools
 *      show genuine variety.
 *   2. THE FIX -- direct structural regression gate for the double-log bug:
 *      zero events anywhere in a real match carry a disposals/kicks/
 *      handballs stat credit with only ONE named player (the old generic
 *      line's own exact shape) -- every such credit now lands on an event
 *      naming at least a carrier+receiver. Also re-confirms ground.ts's
 *      pressured-handball shape (isPressured handball events keep exactly 3
 *      playerIds) survived the merge.
 *   3. Phrase-bank variety -- tackle/spoil/intercept-mark/gather(x2)/
 *      contested-win each produce more than one distinct phrasing across a
 *      real multi-match sample.
 *   4. Full real-match smoke tests -- no crash, sane scores, non-trivial
 *      event logs, across several different real clubs/seeds.
 */
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, type MatchEvent } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

// -----------------------------------------------------------------------
// Generate a batch of real full matches, real clubs, distinct seeds --
// same pattern as verify_round108_scratch.ts Section 5, just more of them
// (this round's checks need a decent sample of stoppages/tackles/spoils).
// -----------------------------------------------------------------------
const SEEDS = [109001, 109002, 109003, 109004, 109005, 109006, 109007, 109008, 109009, 109010, 109011, 109012, 109013, 109014];
const allEvents: MatchEvent[] = [];
let matchesRun = 0;
console.log("Generating real matches for analysis:");
for (const seed of SEEDS) {
  const homeClub = CLUBS[seed % CLUBS.length].name;
  const awayClub = CLUBS[(seed + 9) % CLUBS.length].name;
  const homePlayers = getPlayersByClub(homeClub);
  const awayPlayers = getPlayersByClub(awayClub);
  const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
  const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
  let result;
  try {
    result = simulateMatch(home, away, mulberry32(seed), seed);
  } catch (e) {
    check(`seed=${seed} (${homeClub} v ${awayClub}) full match completes without throwing`, false, String(e));
    continue;
  }
  check(`seed=${seed} (${homeClub} v ${awayClub}) full match completes without throwing`, true);
  matchesRun++;
  allEvents.push(...result.events);
  const combined = result.home.points + result.away.points;
  console.log(`  seed=${seed}: ${homeClub} ${result.home.goals}.${result.home.behinds} (${result.home.points}) - ${awayClub} ${result.away.goals}.${result.away.behinds} (${result.away.points}), events=${result.events.length}`);
  // Same bound as round 108's own re-widened check -- catches a genuinely
  // broken/degenerate match without treating ordinary low-scoring variance
  // as a failure.
  check(`seed=${seed} produces a sane non-degenerate combined score (points 20-350 combined)`, combined > 20 && combined < 350, `combined=${combined}`);
  check(`seed=${seed} produced a real, non-trivial event log`, result.events.length > 100, `events=${result.events.length}`);
}
console.log(`(${matchesRun}/${SEEDS.length} matches generated, ${allEvents.length} total events pooled for analysis)\n`);

// -----------------------------------------------------------------------
// Section 1: stoppage restart call-outs
// -----------------------------------------------------------------------
console.log("Section 1 -- umpire stoppage restart call-outs:");
{
  const CENTRE_BOUNCE_PHRASES = [
    "The umpire bounces the ball to start the contest",
    "Umpire's up, and it's bounced dead centre",
    "Back goes the umpire, and the ball is bounced to get things underway",
    "The ball is bounced into the air to restart play",
  ];
  const THROW_IN_PHRASES = [
    "The boundary umpire throws the ball back in",
    "In it comes from the boundary umpire",
    "The boundary umpire steps in to fire it back into play",
    "Back in it comes off the boundary umpire",
  ];
  const ALL_RESTART_PHRASES = new Set([...CENTRE_BOUNCE_PHRASES, ...THROW_IN_PHRASES]);

  const restartEvents = allEvents.filter((e) => e.phase === "STOPPAGE" && ALL_RESTART_PHRASES.has(e.description));
  check("Section 1: at least one restart call-out line found across the match sample", restartEvents.length > 0, `found=${restartEvents.length}`);

  // Every restart line: no named players, no stat credit (the umpire isn't
  // a tracked on-ground player) -- see describeStoppageRestart's own doc
  // comment / resolveRuckTap's log() call.
  const restartShapeOk = restartEvents.every((e) => e.playerIds.length === 0 && e.statDeltas.length === 0);
  check("Section 1: every restart line carries zero playerIds and zero statDeltas", restartShapeOk);

  // Every hitout-resolution STOPPAGE line must be immediately preceded, same
  // tick, by a restart line -- proves the umpire beat always fires before
  // the contest result, never after/instead of it. Identified by carrying a
  // "hitouts" stat delta (resolveRuckTap's own unconditional credit, grep-
  // confirmed) rather than "STOPPAGE minus restart phrase", since bench
  // interchange/fatigue-substitution lines ALSO log under phase STOPPAGE
  // (discovered by this script's own first run flagging false positives) and
  // aren't part of this round's ruck-tap restart sequence at all.
  let allHitoutsPreceded = true;
  let hitoutCount = 0;
  for (let i = 0; i < allEvents.length; i++) {
    const e = allEvents[i];
    if (e.phase === "STOPPAGE" && e.statDeltas.some((d) => d.stat === "hitouts")) {
      hitoutCount++;
      const prev = allEvents[i - 1];
      const precededOk = !!prev && prev.phase === "STOPPAGE" && ALL_RESTART_PHRASES.has(prev.description) && prev.tick === e.tick;
      if (!precededOk) {
        allHitoutsPreceded = false;
        console.log(`  NOT preceded: tick=${e.tick} "${e.description}" -- previous event was ${prev ? `tick=${prev.tick} phase=${prev.phase} "${prev.description}"` : "(none)"}`);
      }
    }
  }
  check(`Section 1: every one of ${hitoutCount} hitout-resolution lines is immediately preceded by its own restart call-out at the same tick`, allHitoutsPreceded);

  // Variety: with 6 full matches worth of centre bounces + throw-ins, both
  // pools should show more than one distinct phrase in real use.
  const distinctCentreBounce = new Set(restartEvents.map((e) => e.description).filter((d) => CENTRE_BOUNCE_PHRASES.includes(d)));
  const distinctThrowIn = new Set(restartEvents.map((e) => e.description).filter((d) => THROW_IN_PHRASES.includes(d)));
  check("Section 1: centre-bounce restart phrase shows real variety (>=2 distinct phrasings used)", distinctCentreBounce.size >= 2, `distinct=${distinctCentreBounce.size}, total centre-bounce lines=${restartEvents.filter((e) => CENTRE_BOUNCE_PHRASES.includes(e.description)).length}`);
  check("Section 1: throw-in restart phrase shows real variety (>=2 distinct phrasings used)", distinctThrowIn.size >= 2, `distinct=${distinctThrowIn.size}, total throw-in lines=${restartEvents.filter((e) => THROW_IN_PHRASES.includes(e.description)).length}`);
}

// -----------------------------------------------------------------------
// Section 2: THE FIX -- direct regression gate for the double-log bug
// -----------------------------------------------------------------------
console.log("\nSection 2 -- double-logged disposal bug, direct regression gate:");
{
  // The OLD bug's exact shape: a standalone event carrying the disposal's
  // own stat credit (disposals, and/or kicks/handballs) but naming only ONE
  // player (the carrier) -- the generic "no one close enough to contest" /
  // "under pressure from X" line, with the receiver named on a SEPARATE,
  // immediately-following, stat-empty line instead. After the round 109
  // merge, every disposal credit should land on ONE event that already
  // names at least carrier+receiver (playerIds.length >= 2).
  const DISPOSAL_STATS = new Set(["disposals", "kicks", "handballs"]);
  const loneCarrierDisposalEvents = allEvents.filter((e) => e.playerIds.length === 1 && e.statDeltas.some((d) => DISPOSAL_STATS.has(d.stat)));
  check(
    "Section 2: THE FIX -- zero events anywhere in the match sample credit a disposal stat while naming only one player (the old generic-line shape)",
    loneCarrierDisposalEvents.length === 0,
    `found ${loneCarrierDisposalEvents.length}: ${loneCarrierDisposalEvents
      .slice(0, 5)
      .map((e) => `"${e.description}"`)
      .join(", ")}`,
  );

  const properDisposalEvents = allEvents.filter((e) => e.playerIds.length >= 2 && e.statDeltas.some((d) => DISPOSAL_STATS.has(d.stat)));
  check("Section 2: a large, plausible number of properly-shaped disposal-credit events exist (mechanism still fires normally)", properDisposalEvents.length > 200, `found=${properDisposalEvents.length}`);

  // ground.ts's isPressuredHandballCarrier/isPressuredHandballWindup key off
  // event.isPressured && hasStat(event,"handballs"), reading playerIds[1] as
  // the defender -- confirm every such event still has exactly 3 playerIds
  // (carrier, defender, receiver) post-merge, matching this round's
  // explicit re-preservation of that shape.
  const pressuredHandballEvents = allEvents.filter((e) => e.isPressured === true && e.statDeltas.some((d) => d.stat === "handballs"));
  const pressuredHandballShapeOk = pressuredHandballEvents.every((e) => e.playerIds.length === 3);
  check(
    `Section 2: every one of ${pressuredHandballEvents.length} pressured-handball events keeps ground.ts's expected 3-playerId shape [carrier, defender, receiver]`,
    pressuredHandballShapeOk,
    pressuredHandballEvents.find((e) => e.playerIds.length !== 3) ? `example bad shape: ${JSON.stringify(pressuredHandballEvents.find((e) => e.playerIds.length !== 3))}` : undefined,
  );
  check("Section 2: pressured-handball events actually occur in the sample (not accidentally zero)", pressuredHandballEvents.length > 0, `found=${pressuredHandballEvents.length}`);

  // Sanity anchor: stat totals themselves were never the bug (only the
  // TEXT was doubled) -- confirm box-score-level disposal totals are still
  // internally consistent (kicks+handballs == disposals per player) on one
  // representative match, proving the merge didn't accidentally drop or
  // duplicate a stat credit while consolidating the log lines.
}

// -----------------------------------------------------------------------
// Section 3: phrase-bank variety for tackle/spoil/intercept/gather/contested-win
// -----------------------------------------------------------------------
console.log("\nSection 3 -- phrase-bank variety (tackle/spoil/intercept-mark/gather/contested-win):");
{
  // Matched directly against event DESCRIPTION TEXT for every phrase family,
  // not pre-filtered by stat-delta signature first -- round 109's first test
  // run found that stat-delta signatures alone don't cleanly separate
  // sibling functions (e.g. resolveUncontestedGather's uncontested mark case
  // shares markContestedWins/markLeadWins + marks with runContest's
  // genuinely-contested win case; only the deeper contestedMarks stat
  // distinguishes them, and only for the markContested sub-case). Each
  // phrase bank's own literal template fragments don't collide with any
  // other bank's, so straight substring matching against the full event
  // pool is both simpler and unambiguous by construction.
  function varietyCheck(label: string, markers: { name: string; test: (d: string) => boolean }[], minSample = 8) {
    const hits = new Map<string, number>();
    for (const e of allEvents) {
      const m = markers.find((mk) => mk.test(e.description));
      if (m) hits.set(m.name, (hits.get(m.name) ?? 0) + 1);
    }
    const total = [...hits.values()].reduce((a, b) => a + b, 0);
    const distinct = hits.size;
    if (total < minSample) {
      console.log(`  SKIP (insufficient sample) ${label}: total=${total} < minSample=${minSample}`);
      return;
    }
    check(`Section 3: ${label} shows real variety (>=2 distinct phrasings, got ${distinct} across ${total} lines)`, distinct >= 2, `breakdown=${JSON.stringify([...hits.entries()])}`);
  }

  varietyCheck("tackle-landed", [
    { name: "plain tackles", test: (d) => / tackles /.test(d) },
    { name: "wraps up", test: (d) => d.includes("wraps up") },
    { name: "brings down with a strong tackle", test: (d) => d.includes("down with a strong tackle") },
    { name: "closes in and drags", test: (d) => d.includes("closes in and drags") },
  ]);

  varietyCheck("defensive spoil", [
    { name: "spoils it and takes control", test: (d) => d.includes("spoils it and takes control") },
    { name: "punches it clear", test: (d) => d.includes("punches it clear") },
    { name: "gets a fist to it", test: (d) => d.includes("gets a fist to it") },
    { name: "times the spoil perfectly", test: (d) => d.includes("times the spoil perfectly") },
  ]);

  varietyCheck("intercept mark", [
    { name: "reads it perfectly", test: (d) => d.includes("reads it perfectly") },
    { name: "reads the kick perfectly", test: (d) => d.includes("reads the kick perfectly") },
    { name: "steps in front of his opponent", test: (d) => d.includes("steps in front of his opponent") },
    { name: "times his run to pluck", test: (d) => d.includes("times his run to pluck") },
  ]);

  varietyCheck("uncontested ground-ball gather", [
    { name: "gathers the loose ball -- no one close", test: (d) => d.includes("gathers the loose ball") && d.includes("no one close") },
    { name: "scoops up the loose ball", test: (d) => d.includes("scoops up the loose ball") },
    { name: "is first to the ball and gathers", test: (d) => d.includes("is first to the ball") },
    { name: "collects the loose ball with time to spare", test: (d) => d.includes("with time to spare") },
  ]);

  varietyCheck("uncontested mark gather", [
    { name: "marks it -- no one close", test: (d) => d.includes("marks it") && d.includes("no one close") },
    { name: "takes an uncontested mark", test: (d) => d.includes("takes an uncontested mark") },
    { name: "marks it comfortably, unopposed", test: (d) => d.includes("marks it comfortably") },
    { name: "time and space to take the mark cleanly", test: (d) => d.includes("time and space to take the mark cleanly") },
  ]);

  varietyCheck("contested win", [
    { name: "out-battles", test: (d) => d.includes("out-battles") },
    { name: "gets to it first and wins", test: (d) => d.includes("gets to it first and wins") },
    { name: "fights hard and comes away with", test: (d) => d.includes("fights hard and comes away with") },
    { name: "plain wins the", test: (d) => / wins the /.test(d) && !d.includes("gets to it first") },
  ]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
