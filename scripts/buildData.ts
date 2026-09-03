/**
 * Data pipeline: `data/players_master.csv` (751 real AFL players) ->
 * `src/data/generated/players.json`, typed against `src/types/player.ts`.
 *
 * Run with: `npm run build:data` (== `node --experimental-strip-types scripts/buildData.ts`)
 * Zero npm dependencies on purpose — see scripts/csv.ts for why.
 *
 * Round 63 fix: CSV_PATH used to point two directories up, at the Obsidian
 * vault's `Player Database/players_master.csv` — OUTSIDE this git repo. That
 * worked locally (the vault folder is always there) but broke GitHub Actions:
 * a fresh checkout only has what's tracked in `app/`, so `players.json` was
 * never generated and `src/data/loadPlayers.ts`'s import of it failed the
 * build with "Cannot find module './generated/players.json'". Fixed by
 * copying the CSV into the repo at `app/data/players_master.csv` (now the
 * canonical, CI-facing copy) and pointing CSV_PATH there. If the player
 * database is ever refreshed (e.g. backlog item #1, end-of-season refresh),
 * write the new CSV to *this* in-repo path — the vault's own
 * `Player Database/players_master.csv` is no longer what the build reads.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const OUT_DIR = join(__dirname, "..", "src", "data", "generated");
const OUT_PATH = join(OUT_DIR, "players.json");

// Every CSV column that should stay a string. Everything else is coerced to a number.
const STRING_FIELDS = new Set([
  "Team",
  "OriginClub",
  "fname",
  "lname",
  "homeState",
  "draft_draftType",
  "archetype",
  "archetype_reason",
  // Added Aug 2026 SuperCoach trend recalibration (see Schema.md) — sc_trend_z is
  // numeric-looking but kept as a string like archetype_reason above (it's a
  // transparency/provenance field, not consumed by engine logic); sc_trend_years is a
  // comma-joined year list ("2022,2023,2024") and would throw the numeric-coercion
  // error below if left off this list. Both are "" for players with no SuperCoach match.
  "sc_trend_z",
  "sc_trend_years",
]);

function coerceRow(raw: Record<string, string>): Player {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (STRING_FIELDS.has(key)) {
      out[key] = value;
    } else {
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new Error(`Expected numeric CSV field "${key}" but got ${JSON.stringify(value)}`);
      }
      out[key] = n;
    }
  }
  // Round 68 — frozen real-world identity, snapshotted here (generation time) and never touched
  // again. See Player.realFullName's own doc comment for why this exists and what depends on it.
  out.realFullName = `${out.fname} ${out.lname}`;

  return out as unknown as Player;
}

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const rawRows = parseCsvToObjects(csvText);
  console.log(`Parsed ${rawRows.length} CSV rows`);

  const players = rawRows.map(coerceRow);

  // --- Sanity checks — fail loudly rather than silently ship bad data. ---
  const ids = new Set(players.map((p) => p.PlayerID));
  if (ids.size !== players.length) {
    throw new Error(`Duplicate PlayerID detected: ${players.length} rows but only ${ids.size} unique IDs`);
  }
  const potBelowOvr = players.filter((p) => p.POT < p.OVR);
  if (potBelowOvr.length > 0) {
    throw new Error(
      `POT < OVR for ${potBelowOvr.length} player(s): ${potBelowOvr.map((p) => `${p.fname} ${p.lname}`).join(", ")}`,
    );
  }
  const clubCounts = new Map<string, number>();
  for (const p of players) clubCounts.set(p.Team, (clubCounts.get(p.Team) ?? 0) + 1);
  if (clubCounts.size !== 18) {
    throw new Error(`Expected 18 clubs, found ${clubCounts.size}: ${[...clubCounts.keys()].join(", ")}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(players, null, 2));

  console.log(`Wrote ${players.length} players -> ${OUT_PATH}`);
  console.log(`Clubs: ${clubCounts.size} (expected 18)`);
  console.log(`PlayerID uniqueness: ok (${ids.size}/${players.length})`);
  console.log(`POT >= OVR invariant: ok (0 violations)`);
}

main();
