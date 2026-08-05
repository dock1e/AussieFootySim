/**
 * The balance simulator — Engine.md "Balance simulator": "a simulator which
 * we can run many thousands of iterations through to adjust outliers and
 * averages." Runs N fully-simulated matches headless (no rendering, same
 * engine module the browser uses) and streams one JSONL record per game.
 *
 * Usage: npm run simulate -- --games=10000 --seed=1 --out=sim-results/results.jsonl
 *
 * Zero npm dependencies, same as scripts/buildData.ts — this is exactly the
 * payoff Engine.md's tech-stack table calls out for keeping the engine a
 * "plain TypeScript module, zero DOM/browser dependencies": it runs
 * identically here, headless in Node, and inside the browser.
 */
import { mkdirSync, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { pickBest22 } from "../src/engine/team.ts";
import { CLUBS } from "../src/types/club.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) args[m[1]] = m[2];
  }
  return {
    games: Number(args.games ?? 100),
    seed: Number(args.seed ?? 1),
    out: args.out ?? join(__dirname, "..", "sim-results", "results.jsonl"),
    recordEvents: args.recordEvents === "true",
  };
}

function main() {
  const { games, seed, out, recordEvents } = parseArgs(process.argv.slice(2));
  console.log(`Simulating ${games} games (base seed ${seed}) -> ${out}`);

  mkdirSync(dirname(out), { recursive: true });
  const stream = createWriteStream(out, { flags: "w" });

  // Pre-build each club's best-22 once (roster doesn't change mid-run) rather
  // than re-selecting 22 players from a ~40-player list every single game.
  const teams = CLUBS.map((c) => pickBest22(c.name, getPlayersByClub(c.name)));

  let totalPoints = 0;
  let totalGames = 0;
  const margins: number[] = [];
  const teamScores: number[] = [];

  for (let i = 0; i < games; i++) {
    const home = teams[i % teams.length];
    const away = teams[(i + Math.floor(teams.length / 2)) % teams.length];
    if (home.name === away.name) continue; // skip the degenerate self-fixture that can occur with an odd club count

    const gameSeed = seed + i;
    const result = simulateMatch(home, away, mulberry32(gameSeed), gameSeed, { recordEvents });

    const record = {
      game: i,
      seed: gameSeed,
      home: { name: result.home.name, goals: result.home.goals, behinds: result.home.behinds, points: result.home.points },
      away: { name: result.away.name, goals: result.away.goals, behinds: result.away.behinds, points: result.away.points },
      margin: result.home.points - result.away.points,
      boxScore: result.boxScore,
    };
    stream.write(JSON.stringify(record) + "\n");

    totalPoints += result.home.points + result.away.points;
    teamScores.push(result.home.points, result.away.points);
    margins.push(Math.abs(result.home.points - result.away.points));
    totalGames++;
  }

  stream.end();

  const avgTeamScore = totalPoints / (totalGames * 2);
  const avgMargin = margins.reduce((a, b) => a + b, 0) / totalGames;
  const draws = margins.filter((m) => m === 0).length;
  const blowouts = margins.filter((m) => m >= 60).length; // "blowout" threshold, adjust as a real definition emerges

  console.log(`\n${totalGames} games simulated.`);
  console.log(`Avg team score: ${avgTeamScore.toFixed(1)} pts (real AFL 2025 average is roughly 75-90)`);
  console.log(`Avg margin: ${avgMargin.toFixed(1)} pts`);
  console.log(`Draws: ${draws} (${((draws / totalGames) * 100).toFixed(1)}%)`);
  console.log(`Blowouts (60+): ${blowouts} (${((blowouts / totalGames) * 100).toFixed(1)}%)`);
  console.log(`Min/max team score: ${Math.min(...teamScores)} / ${Math.max(...teamScores)}`);
  console.log(
    `\nScores are still uncalibrated (see src/engine/match.ts "Placeholder probabilities") — this run is a shape check, not a tuning result yet.`,
  );
}

main();
