/**
 * Round C155 — Player Editor: standalone admin tool server.
 *
 * Launch: `node --experimental-strip-types tools/player-editor/server.ts` (run from the `app/`
 * directory, matching this repo's own established convention for every other `scripts/*.ts` entry
 * point — `npx`/`tsx` are both confirmed broken in this sandbox across every prior round).
 * Then open http://localhost:5155 in a browser.
 *
 * A small dependency-free `node:http` server — no Express (not a project dependency; see
 * package.json, checked before writing this). Serves a tiny static client (`public/`) and a JSON
 * API backed by `lib.ts`, which does all the real work by calling the actual engine functions
 * (`applyFairnessPass` etc.) unmodified.
 *
 * Deliberately lives outside `src/` and is never imported by the React game bundle/routes — this
 * is Tyler's own explicitly chosen shape (AskUserQuestion: "a standalone tool, separate from the
 * actual game"), not a screen inside SimAFL itself.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { RATED_ATTRIBUTES, type RatedAttribute } from "../../src/types/player.ts";
import { loadPopulation, searchPlayers, findPlayer, playerDetail, previewChange, saveChange, type Population } from "./lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5155);
const PUBLIC_DIR = join(__dirname, "public");

let pop: Population = loadPopulation();
console.log(`Loaded ${pop.players.length} players from ${new URL("../../data/players_master.csv", import.meta.url).pathname}`);
console.log(`Population OVR stats: mean=${pop.populationStats.mean.toFixed(2)} stdDev=${pop.populationStats.stdDev.toFixed(2)}`);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function isRatedAttribute(k: string): k is RatedAttribute {
  return (RATED_ATTRIBUTES as readonly string[]).includes(k);
}

function parseChanges(raw: unknown): Partial<Record<RatedAttribute, number>> {
  const changes: Partial<Record<RatedAttribute, number>> = {};
  if (!raw || typeof raw !== "object") return changes;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isRatedAttribute(k) && typeof v === "number" && Number.isFinite(v)) {
      changes[k] = v;
    }
  }
  return changes;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/api/players") {
      const q = url.searchParams.get("q") ?? "";
      return sendJson(res, 200, searchPlayers(pop, q));
    }

    const detailMatch = url.pathname.match(/^\/api\/players\/(\d+)$/);
    if (req.method === "GET" && detailMatch) {
      const id = Number(detailMatch[1]);
      const p = findPlayer(pop, id);
      if (!p) return sendJson(res, 404, { error: `No player with id ${id}` });
      return sendJson(res, 200, playerDetail(pop, p));
    }

    if (req.method === "POST" && url.pathname === "/api/preview") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = Number(body.id);
      const p = findPlayer(pop, id);
      if (!p) return sendJson(res, 404, { error: `No player with id ${id}` });
      const changes = parseChanges(body.changes);
      return sendJson(res, 200, previewChange(pop, p, changes));
    }

    if (req.method === "POST" && url.pathname === "/api/save") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const id = Number(body.id);
      if (!findPlayer(pop, id)) return sendJson(res, 404, { error: `No player with id ${id}` });
      const changes = parseChanges(body.changes);
      const { result, player } = saveChange(pop, id, changes);
      return sendJson(res, 200, { result, player: playerDetail(pop, player) });
    }

    if (req.method === "POST" && url.pathname === "/api/reload") {
      // Re-reads the CSV and recomputes the population-reference stats fresh — useful after an
      // external script (e.g. this round's own tuning helper) has written the CSV directly.
      pop = loadPopulation();
      return sendJson(res, 200, { reloaded: true, players: pop.players.length });
    }

    // --- Static file serving for the client ---
    if (req.method === "GET") {
      let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const fullPath = join(PUBLIC_DIR, filePath);
      if (!fullPath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });
      if (existsSync(fullPath)) {
        const ext = extname(fullPath);
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        res.end(readFileSync(fullPath));
        return;
      }
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Player Editor running at http://localhost:${PORT}`);
});
