// Round 81 vault-integration generator — Tyler's ask: (1) draft pool players as nodes linked to
// archetype + scouting tier, (2) the draft pick inventory as nodes linked to clubs, (3) real
// record/award holders (players + coaches) linked back to their record.
//
// Run with: node --experimental-strip-types generateRound81VaultNotes.mjs <part>
//   part = players | tiers | picks | clubs | records | all
//
// Writes directly into the Obsidian vault at VAULT below. Idempotent: skips a file that already
// exists (players/tiers/picks note creation) or a section that's already present (club/player/
// coach/Records.md edits), so re-running after a partial failure is safe.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VAULT = "/sessions/modest-wizardly-ritchie/mnt/AussieFootySim";
const APP = `${VAULT}/app`;

const part = process.argv[2] ?? "all";

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function writeIfAbsent(path, content, stats) {
  if (existsSync(path)) {
    stats.skipped++;
    return;
  }
  writeFileSync(path, content);
  stats.created++;
}

// ---------------------------------------------------------------------------
// PART A — Draft pool players (archetype + scouting tier nodes)
// ---------------------------------------------------------------------------
async function partPlayers() {
  const { generateProspectPool, scoutingTiersForPool } = await import(`${APP}/src/engine/draft.ts`);
  const { ALL_PLAYERS } = await import(`${APP}/src/data/loadPlayers.ts`);
  const { REAL_PROSPECTS, writeupTextFor, scoutingProseSignalFor, externalConsensusRankFor } = await import(`${APP}/src/data/realProspects.ts`);

  const YEAR = 2026;
  const SEED = 2026; // matches this project's own verify_round79/80_scratch.ts convention
  const pool = generateProspectPool(ALL_PLAYERS, YEAR, SEED);
  const tiers = scoutingTiersForPool(pool);

  const DIR = `${VAULT}/Draft Prospects Database/2026 Draft Pool`;
  ensureDir(DIR);

  const stats = { created: 0, skipped: 0 };
  const tierSlug = (t) => t.toLowerCase().replace(/\s+/g, "-");
  const archetypeLink = (a) => `[[Player Database/Archetypes/${a}\\|${a}]]`;
  const tierLink = (t) => `[[Draft Prospects Database/Scouting Tiers/${t}\\|${t}]]`;

  const index = [];

  // Two fictional prospects can coincidentally share a display name (e.g. "Sonny Smiler" NT vs
  // NSW this pool) — disambiguate by home state on every occurrence past the first so neither
  // note silently clobbers/skips the other.
  const nameCounts = new Map();
  for (const p of pool) {
    const displayName = p.realFullName ?? `${p.fname} ${p.lname}`;
    nameCounts.set(displayName, (nameCounts.get(displayName) ?? 0) + 1);
  }
  const seenSoFar = new Map();

  for (const p of pool) {
    const tier = tiers.get(p.PlayerID) ?? "Average";
    const isReal = !!p.realFullName;
    const record = isReal ? REAL_PROSPECTS.find((r) => r.name === p.realFullName) : null;
    const displayName = p.realFullName ?? `${p.fname} ${p.lname}`;
    let safeName = displayName.replace(/[\\/:*?"<>|]/g, "");
    if (nameCounts.get(displayName) > 1) {
      const n = (seenSoFar.get(displayName) ?? 0) + 1;
      seenSoFar.set(displayName, n);
      safeName = `${safeName} (${p.homeState}, PlayerID ${p.PlayerID})`;
    }
    const fpath = `${DIR}/${safeName}.md`;

    const writeup = record ? writeupTextFor(record) : "";
    const proseSignal = record ? scoutingProseSignalFor(record) : null;
    const extRank = record ? externalConsensusRankFor(record) : null;

    const fm = [
      "---",
      `name: "${displayName}"`,
      `source: "${isReal ? "real" : "fictional"}"`,
      `archetype: "${p.archetype}"`,
      `scoutingTier: "${tier}"`,
      `POT: ${p.POT}`,
      `homeState: "${p.homeState}"`,
      extRank !== null ? `externalConsensusRank: ${extRank}` : null,
      "tags:",
      `  - "draft-prospect"`,
      `  - "draft-pool/2026"`,
      `  - "archetype/${tierSlug(p.archetype)}"`,
      `  - "scouting-tier/${tierSlug(tier)}"`,
      "---",
      "",
    ]
      .filter((l) => l !== null)
      .join("\n");

    const bodyLines = [
      `# ${displayName}`,
      "",
      `Back to [[Draft Prospects Database/2026 Draft Pool|2026 Draft Pool]]. ${archetypeLink(p.archetype)} &middot; ${tierLink(tier)} &middot; POT **${p.POT}** &middot; from ${p.homeState}${isReal ? "" : " (fictional)"}`,
      "",
    ];

    if (writeup) {
      bodyLines.push("## Scouting report", "", writeup, "");
      if (proseSignal && proseSignal.tier !== "none") {
        bodyLines.push(`*Write-up prose reads "${proseSignal.tier}" tier (matched: ${proseSignal.matchedPhrases.join(", ")}).*`, "");
      }
    }
    if (extRank !== null) {
      bodyLines.push(`*Real external recruiter consensus rank: ${extRank} — see [[Scouting Tiers and Predicted Draft Order]].*`, "");
    }
    bodyLines.push("---", `Back to [[Draft Prospects Database/Draft Prospects Database|Draft Prospects Database]]`);

    writeIfAbsent(fpath, fm + bodyLines.join("\n") + "\n", stats);
    index.push({ name: displayName, archetype: p.archetype, tier, pot: p.POT, isReal });
  }

  // Index/overview note
  const tierCounts = {};
  for (const row of index) tierCounts[row.tier] = (tierCounts[row.tier] ?? 0) + 1;
  const overviewPath = `${VAULT}/Draft Prospects Database/2026 Draft Pool.md`;
  if (!existsSync(overviewPath)) {
    const tierOrder = ["Generational Talent", "Superstar", "Elite", "Great", "Good", "Average", "Sub-par"];
    const lines = [
      "---",
      "tags: [node, draft-prospects, draft-pool/2026]",
      "---",
      "",
      "# 2026 Draft Pool",
      "",
      "Back to [[Draft Prospects Database]]. The 195-prospect pool for the 2026 AFL National Draft, generated by",
      "AussieFootySim's own `generateProspectPool` (seed 2026) — the same real, production function the app itself",
      "uses, run standalone so every prospect's true archetype and scouting tier is visible here (unfogged),",
      "rather than only whatever a specific save has already spent scout points to reveal. See",
      "[[Scouting Tiers and Predicted Draft Order]] for the full mechanism this pool's tiers are built from.",
      "",
      "**Real-vs-fictional**: " + `${index.filter((r) => r.isReal).length} of 195 are real, named prospects sourced from Tyler's own draft data (` + `${index.filter((r) => !r.isReal).length} fictional top-up).`,
      "",
      "## By scouting tier",
      "",
      ...tierOrder.filter((t) => tierCounts[t]).map((t) => `- [[Draft Prospects Database/Scouting Tiers/${t}|${t}]] — ${tierCounts[t]}`),
      "",
      "## Full pool",
      "",
      "One note per prospect in `2026 Draft Pool/`, each linked to its [[Player Database/Player Database|Archetype]]",
      "and [[Draft Prospects Database/Draft Prospects Database|scouting tier]] page — browse via the folder or each",
      "tier page's own backlinks.",
    ];
    writeFileSync(overviewPath, lines.join("\n") + "\n");
    stats.created++;
  } else {
    stats.skipped++;
  }

  console.log(`Players: created ${stats.created}, skipped (already existed) ${stats.skipped}`);
  console.log("Tier distribution:", tierCounts);
}

// ---------------------------------------------------------------------------
// PART A2 — Scouting tier note pages (Generational Talent, Superstar, ...)
// ---------------------------------------------------------------------------
function partTiers() {
  const DIR = `${VAULT}/Draft Prospects Database/Scouting Tiers`;
  ensureDir(DIR);
  const stats = { created: 0, skipped: 0 };

  const TIERS = [
    {
      name: "Generational Talent",
      floor: "POT >= 79",
      desc: "The rarest tier — a prospect whose ceiling is a clear step above a corroborated Superstar claim. Structurally decoupled from \"pool rank 1\" as of round 79 (previously could never exceed 1 per pool by construction); 2026's real corpus currently produces 1-2 per pool in the large majority of sampled seeds.",
    },
    {
      name: "Superstar",
      floor: "POT >= 75",
      desc: "Grounded against real AFL Hall of Fame Legend-vs-Superstar history (round 78) — real draftees reaching 2+ career All-Australian selections average ~4.3/year, and this tier is calibrated to land 2-6 per 195-pool draft year (40/40 simulated years in round 79's own sweep).",
    },
    { name: "Elite", floor: "POT >= 68 (prose floor) / percentile-based", desc: "Clear first-round-caliber prospect — real recruiter language like \"elite,\" \"one of the best,\" \"outstanding\" corroborates this tier, or the pool's own top percentile band where no write-up exists." },
    { name: "Great", floor: "POT >= 63 (prose floor) / percentile-based", desc: "\"Great or steady role player\" language (classy, reliable, clean hands, impressive) or the pool's next percentile band." },
    { name: "Good", floor: "percentile-based", desc: "Solid, competitive-level prospect — the pool's middle percentile band." },
    { name: "Average", floor: "percentile-based", desc: "The pool's typical, unremarkable-projection prospect." },
    { name: "Sub-par", floor: "percentile-based", desc: "The pool's bottom percentile band — a long-odds selection." },
  ];

  for (const t of TIERS) {
    const fpath = `${DIR}/${t.name}.md`;
    const content = [
      "---",
      `tags: [node, scouting-tier]`,
      `tier: "${t.name}"`,
      "---",
      "",
      `# ${t.name}`,
      "",
      "Back to [[Draft Prospects Database]] &middot; [[Draft Prospects Database/2026 Draft Pool|2026 Draft Pool]].",
      "",
      `**Floor:** ${t.floor}`,
      "",
      t.desc,
      "",
      "See [[Scouting Tiers and Predicted Draft Order]] for the full mechanism (write-up-prose signal,",
      "external-consensus corroboration, and percentile fallback) that assigns this tier.",
      "",
      "## Prospects at this tier",
      "",
      "See this page's own backlinks (every 2026 Draft Pool prospect note tagged at this tier links here).",
    ].join("\n") + "\n";
    writeIfAbsent(fpath, content, stats);
  }

  console.log(`Tiers: created ${stats.created}, skipped ${stats.skipped}`);
}

// ---------------------------------------------------------------------------
// PART B — Draft pick inventory, linked to clubs
// ---------------------------------------------------------------------------
async function partPicks() {
  const { REAL_PICKS_2026, REAL_FUTURE_PICKS_2027, REAL_FUTURE_PICKS_2028, dviValueForPick, dviValueForFuturePick } = await import(`${APP}/src/engine/draftPicks.ts`);
  const { CLUBS } = await import(`${APP}/src/types/club.ts`);

  const clubName = (id) => CLUBS.find((c) => c.ClubID === id)?.name ?? `Unknown-${id}`;
  const DIR = `${VAULT}/Draft Picks Database/Picks`;
  ensureDir(DIR);
  const stats = { created: 0, skipped: 0 };

  const heldByClubYear = {}; // clubName -> year -> [pick summary lines]

  function writePickNote(pick, value, label) {
    const yearDir = `${DIR}/${pick.year}`;
    ensureDir(yearDir);
    const safeLabel = label.replace(/[\\/:*?"<>|]/g, "");
    const fpath = `${yearDir}/${safeLabel}.md`;
    const original = clubName(pick.originalClubId);
    const current = clubName(pick.currentClubId);
    const traded = pick.originalClubId !== pick.currentClubId;

    const content = [
      "---",
      `tags: [node, draft-pick, "draft-year/${pick.year}"]`,
      `id: "${pick.id}"`,
      `year: ${pick.year}`,
      `round: ${pick.round}`,
      pick.pickNumber !== null ? `pickNumber: ${pick.pickNumber}` : `pickNumber: null`,
      `originalClub: "${original}"`,
      `currentClub: "${current}"`,
      `dviValue: ${value}`,
      "---",
      "",
      `# ${label}`,
      "",
      `Back to [[Draft Picks Database/Draft Picks Database|Draft Picks Database]].`,
      "",
      `${pick.year} Round ${pick.round}${pick.pickNumber !== null ? `, Pick ${pick.pickNumber}` : " (round-level, not yet numbered)"}.`,
      "",
      `Originally [[Club Database/Clubs/${original}|${original}]]'s selection` +
        (traded ? `, currently held by [[Club Database/Clubs/${current}|${current}]] (traded).` : ", still held by its original club."),
      "",
      `Draft Value Index: **${value}** points (AFL's real 2025+ DVI curve — see [[Draft Picks Database/Draft Picks Database|Draft Picks Database]] for the sourcing).`,
    ].join("\n") + "\n";

    writeIfAbsent(fpath, content, stats);

    const holder = current;
    heldByClubYear[holder] ??= {};
    heldByClubYear[holder][pick.year] ??= [];
    const desc = pick.pickNumber !== null ? `Pick ${pick.pickNumber} (Rd ${pick.round})` : `Rd ${pick.round} (unnumbered)`;
    heldByClubYear[holder][pick.year].push({ desc, value, label, original, traded });
  }

  for (const pick of REAL_PICKS_2026) {
    writePickNote(pick, dviValueForPick(pick.pickNumber), `${pick.year} Pick ${pick.pickNumber}`);
  }
  for (const pick of REAL_FUTURE_PICKS_2027) {
    const original = clubName(pick.originalClubId);
    writePickNote(pick, dviValueForFuturePick(pick.round), `${pick.year} ${original} R${pick.round}`);
  }
  for (const pick of REAL_FUTURE_PICKS_2028) {
    const original = clubName(pick.originalClubId);
    writePickNote(pick, dviValueForFuturePick(pick.round), `${pick.year} ${original} R${pick.round}`);
  }

  // Index note
  const overviewPath = `${VAULT}/Draft Picks Database/Draft Picks Database.md`;
  if (!existsSync(overviewPath)) {
    const totalPicks = REAL_PICKS_2026.length + REAL_FUTURE_PICKS_2027.length + REAL_FUTURE_PICKS_2028.length;
    const lines = [
      "---",
      "tags: [node, draft-picks-database]",
      "---",
      "",
      "# Draft Picks Database",
      "",
      "Back to [[AussieFootySim]]. Companion to [[Player Database/Player Database|Player Database]],",
      "[[Club Database/Club Database|Club Database]] and [[Draft Prospects Database/Draft Prospects Database|Draft Prospects Database]] —",
      `the real 2026-2028 draft-pick-as-asset inventory (\`engine/draftPicks.ts\`, round 74), ${totalPicks} picks total, one note per pick.`,
      "",
      "**Source**: Tyler's \"AFL 2026 Players DB\" workbook, 'AFL Draft Picks' tab, scraped 2026-09-05. 2026 is",
      "numbered (69 of 72 slots — 3 Father-Son/Academy match-bid slots resolve only on draft night, left",
      "unassigned rather than guessed). 2027/2028 are round-level only (no pick number until that year's ladder",
      "is known). Tasmania Devils' real future picks are deliberately excluded — no `ClubID` exists for them yet.",
      "See `engine/draftPicks.ts`'s own doc comment for the full disclosed-gap list.",
      "",
      "**DVI (Draft Value Index)**: AFL's real curve is publicly confirmed at exactly two points (pick 1 = 3000,",
      "pick 54 = 14, picks 55+ = 0) — `dviValueForPick` is a smooth geometric-decay curve anchored at those two",
      "real values, a genuine relative-value curve for comparing AFS's own picks, not a reproduction of AFL's",
      "unpublished full table.",
      "",
      "- `Picks/2026/`, `Picks/2027/`, `Picks/2028/` — one note per pick, linked to its original and current club",
      "- Each club's own page ([[Club Database/Club Database|Club Database]]) carries a \"Draft pick inventory\" section summarising its held picks with links into these folders",
    ];
    writeFileSync(overviewPath, lines.join("\n") + "\n");
    stats.created++;
  } else {
    stats.skipped++;
  }

  console.log(`Picks: created ${stats.created}, skipped ${stats.skipped}`);
  return heldByClubYear;
}

// ---------------------------------------------------------------------------
// PART B2 — Append "Draft pick inventory" section to each club note
// ---------------------------------------------------------------------------
async function partClubs(heldByClubYear) {
  if (!heldByClubYear) {
    const { REAL_PICKS_2026, REAL_FUTURE_PICKS_2027, REAL_FUTURE_PICKS_2028, dviValueForPick, dviValueForFuturePick } = await import(`${APP}/src/engine/draftPicks.ts`);
    const { CLUBS } = await import(`${APP}/src/types/club.ts`);
    const clubName = (id) => CLUBS.find((c) => c.ClubID === id)?.name ?? `Unknown-${id}`;
    heldByClubYear = {};
    const add = (pick, value, label) => {
      const holder = clubName(pick.currentClubId);
      const original = clubName(pick.originalClubId);
      heldByClubYear[holder] ??= {};
      heldByClubYear[holder][pick.year] ??= [];
      const desc = pick.pickNumber !== null ? `Pick ${pick.pickNumber} (Rd ${pick.round})` : `Rd ${pick.round} (unnumbered)`;
      heldByClubYear[holder][pick.year].push({ desc, value, label, original, traded: pick.originalClubId !== pick.currentClubId });
    };
    for (const pick of REAL_PICKS_2026) add(pick, dviValueForPick(pick.pickNumber), `${pick.year} Pick ${pick.pickNumber}`);
    for (const pick of REAL_FUTURE_PICKS_2027) add(pick, dviValueForFuturePick(pick.round), `${pick.year} ${clubName(pick.originalClubId)} R${pick.round}`);
    for (const pick of REAL_FUTURE_PICKS_2028) add(pick, dviValueForFuturePick(pick.round), `${pick.year} ${clubName(pick.originalClubId)} R${pick.round}`);
  }

  const CLUBS_DIR = `${VAULT}/Club Database/Clubs`;
  const MARKER = "## Draft pick inventory (2026-2028)";
  let edited = 0,
    skipped = 0;

  for (const clubFile of readdirSync(CLUBS_DIR)) {
    if (!clubFile.endsWith(".md")) continue;
    const clubName = clubFile.replace(/\.md$/, "");
    const fpath = `${CLUBS_DIR}/${clubFile}`;
    let content = readFileSync(fpath, "utf-8");
    if (content.includes(MARKER)) {
      skipped++;
      continue;
    }
    const held = heldByClubYear[clubName];
    if (!held) continue; // club not found in draftPicks.ts seed data at all (shouldn't happen for the 18 real clubs)

    const yearBlocks = [2026, 2027, 2028]
      .filter((y) => held[y]?.length)
      .map((y) => {
        const rows = held[y]
          .sort((a, b) => a.desc.localeCompare(b.desc, undefined, { numeric: true }))
          .map((r) => `- [[Draft Picks Database/Picks/${y}/${r.label.replace(/[\\/:*?"<>|]/g, "")}|${r.desc}]]${r.traded ? ` (from ${r.original})` : ""} — DVI ${r.value}`)
          .join("\n");
        return `**${y}**\n\n${rows}`;
      })
      .join("\n\n");

    const section = `\n${MARKER}\n\nSee [[Draft Picks Database/Draft Picks Database|Draft Picks Database]] for sourcing and methodology.\n\n${yearBlocks}\n`;

    // Insert before the final "## Design note" section if present, else append at end.
    if (content.includes("## Design note")) {
      content = content.replace("## Design note", `${section}\n## Design note`);
    } else {
      content = content.trimEnd() + "\n" + section;
    }
    writeFileSync(fpath, content);
    edited++;
  }

  console.log(`Clubs: edited ${edited}, skipped (already had section) ${skipped}`);
}

// ---------------------------------------------------------------------------
// PART C — Real-world record/award holders linked back to their record
// ---------------------------------------------------------------------------
function extractPlayerWikilinks(text) {
  // [[Player Database/Players/Club/Last, First|Display]]
  const re = /\[\[Player Database\/Players\/([^|\]]+)\|([^\]]+)\]\]/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push({ path: m[1], display: m[2] });
  return out;
}

function partRecords() {
  const RECORDS_MD = `${VAULT}/Records.md`;
  const CLUBS_DIR = `${VAULT}/Club Database/Clubs`;
  const PLAYERS_DIR = `${VAULT}/Player Database/Players`;
  const COACHES_DIR = `${VAULT}/Coaches Database/Coaches`;
  const MARKER = "## Real-world records & honours";

  // 1) Hand-curated AFL-wide (Records.md) achievements — precise, since this file was read in full.
  const AFLWIDE = [
    ["Collingwood/Pendlebury, Scott", "All-time most career games (437) and most career disposals (11,141)", "Records#Games ✅"],
    ["Port Adelaide/Boak, Travis", "Top-10 all-time career games (387)", "Records#Games ✅"],
    ["North Melbourne/Sheezel, Harry", "Shares the single-game disposals record (54, 2025 v Richmond)", "Records#Disposals / kicks / handballs ✅"],
    ["Collingwood/Mitchell, Tom", "Shares the single-game disposals record (54, 2018 v Collingwood) and a 2018 Brownlow Medal", "Records#Disposals / kicks / handballs ✅"],
    ["Geelong/Dangerfield, Patrick", "Holds the single-game contested-possessions record (29, 2015) and the single-game inside-50s record (16, 2016)", "Records#Marks, tackles, contested possessions, clearances, spoils, hit-outs ✅ (single-game highs, since formal Champion Data counting began — no long historical tail)"],
    ["Adelaide/Laird, Rory", "Shares the single-game tackles record (20, 2022)", "Records#Marks, tackles, contested possessions, clearances, spoils, hit-outs ✅ (single-game highs, since formal Champion Data counting began — no long historical tail)"],
    ["Gold Coast/Rowell, Matt", "Shares the single-game tackles record (20, 2024) and won the 2025 Brownlow Medal", "Records#Marks, tackles, contested possessions, clearances, spoils, hit-outs ✅ (single-game highs, since formal Champion Data counting began — no long historical tail)"],
    ["Carlton/Cripps, Patrick", "2x Brownlow Medallist (2022, 2024)", "Records#Brownlow Medal ✅ (recent winners; full multi-winner history 🔲)"],
    ["Brisbane Lions/Neale, Lachie", "2x Brownlow Medallist (2020, 2023)", "Records#Brownlow Medal ✅ (recent winners; full multi-winner history 🔲)"],
    ["Port Adelaide/Wines, Ollie", "2021 Brownlow Medallist", "Records#Brownlow Medal ✅ (recent winners; full multi-winner history 🔲)"],
    ["Fremantle/Fyfe, Nat", "2x Brownlow Medallist (2015, 2019)", "Records#Brownlow Medal ✅ (recent winners; full multi-winner history 🔲)"],
    ["Richmond/Martin, Dustin", "2017 Brownlow Medallist", "Records#Brownlow Medal ✅ (recent winners; full multi-winner history 🔲)"],
    ["Gold Coast/King, Ben", "2026 Coleman Medal leading goalkicker (season in progress)", "Records#Coleman Medal (leading goalkicker) ✅"],
    ["Geelong/Cameron, Jeremy", "2x Coleman Medal leading goalkicker (2019, 2025)", "Records#Coleman Medal (leading goalkicker) ✅"],
    ["Greater Western Sydney/Hogan, Jesse", "2024 Coleman Medal leading goalkicker; 2015 AFL Rising Star", "Records#Coleman Medal (leading goalkicker) ✅"],
    ["Carlton/Curnow, Charlie", "2023 Coleman Medal leading goalkicker", "Records#Coleman Medal (leading goalkicker) ✅"],
    ["Geelong/Hawkins, Tom", "3x Coleman Medal leading goalkicker (2020, 2021, 2022)", "Records#Coleman Medal (leading goalkicker) ✅"],
    ["Fremantle/Reid, Murphy", "2025 AFL Rising Star", "Records#Rising Star (best young player) ✅"],
    ["Collingwood/Daicos, Nick", "2022 AFL Rising Star, 2025 AFLPA MVP (Leigh Matthews Trophy), 2024 AFLCA Champion Player of the Year", "Records#Rising Star (best young player) ✅"],
    ["Fremantle/Jackson, Luke", "2021 AFL Rising Star (won at Melbourne)", "Records#Rising Star (best young player) ✅"],
    ["Fremantle/Serong, Caleb", "2020 AFL Rising Star", "Records#Rising Star (best young player) ✅"],
    ["Carlton/Walsh, Sam", "2019 AFL Rising Star", "Records#Rising Star (best young player) ✅"],
    ["North Melbourne/Stephenson, Jaidyn", "2018 AFL Rising Star (won at Collingwood)", "Records#Rising Star (best young player) ✅"],
    ["Essendon/McGrath, Andrew", "2017 AFL Rising Star", "Records#Rising Star (best young player) ✅"],
    ["Sydney/Mills, Callum", "2016 AFL Rising Star", "Records#Rising Star (best young player) ✅"],
    ["Western Bulldogs/Bontempelli, Marcus", "3x AFLPA MVP / Leigh Matthews Trophy (2021, 2023, 2024)", "Records#AFLPA MVP — Leigh Matthews Trophy ✅"],
    ["Gold Coast/Anderson, Noah", "2025 AFL Coaches Association Champion Player of the Year (tied)", "Records#AFL Coaches Association Champion Player of the Year ✅"],
    ["Geelong/Smith, Bailey", "2025 AFL Coaches Association Champion Player of the Year (tied)", "Records#AFL Coaches Association Champion Player of the Year ✅"],
    ["Port Adelaide/Butters, Zak", "2023 AFL Coaches Association Champion Player of the Year", "Records#AFL Coaches Association Champion Player of the Year ✅"],
  ];

  // 2) Coaches who hold a real AFL PLAYING record/award (verified against each coach note's own
  //    bio text or plausible era match before including — see this round's own research).
  const COACHES = [
    ["Bob Skilton (Melbourne)", "Tied for the most Brownlow Medals all-time (3: 1959, 1963, 1968, for South Melbourne)"],
    ["Bob Skilton (Sydney)", "Tied for the most Brownlow Medals all-time (3: 1959, 1963, 1968, for South Melbourne)"],
    ["Dick Reynolds (Essendon)", "Tied for the most Brownlow Medals all-time (3: 1934, 1937, 1938, for Essendon)"],
    ["Ian Stewart (Carlton)", "Tied for the most Brownlow Medals all-time (3: 1965, 1966 for St Kilda, 1971 for Richmond) — the only 3-time winner at two different clubs"],
    ["Ian Stewart (Sydney)", "Tied for the most Brownlow Medals all-time (3: 1965, 1966 for St Kilda, 1971 for Richmond) — the only 3-time winner at two different clubs"],
    ["Robert Harvey (Collingwood)", "Top-10 all-time career games (383) and top-2 all-time career disposals (9,656), both for St Kilda; 2x Brownlow Medallist"],
    ["Nathan Buckley (Collingwood)", "The inaugural AFL Rising Star winner (1993, Brisbane Bears)"],
    ["Sam Mitchell (Hawthorn)", "Tied for the 2012 Brownlow Medal (for Hawthorn)"],
  ];

  const stats = { playersEdited: 0, playersSkipped: 0, coachesEdited: 0, coachesSkipped: 0, recordsMdEdited: false };

  // --- Players: AFL-wide hand-curated set ---
  const byPlayerPath = new Map();
  for (const [path, desc, anchor] of AFLWIDE) {
    if (!byPlayerPath.has(path)) byPlayerPath.set(path, []);
    byPlayerPath.get(path).push({ desc, note: "Records", anchor });
  }

  // --- Players: club-level set, auto-extracted from each Club note's "## Club records" section ---
  for (const clubFile of readdirSync(CLUBS_DIR)) {
    if (!clubFile.endsWith(".md")) continue;
    const clubName = clubFile.replace(/\.md$/, "");
    const content = readFileSync(`${CLUBS_DIR}/${clubFile}`, "utf-8");
    const recordsSectionMatch = content.match(/## Club records([\s\S]*?)(\n## |$)/);
    if (!recordsSectionMatch) continue;
    const section = recordsSectionMatch[1];
    for (const { path } of extractPlayerWikilinks(section)) {
      if (!byPlayerPath.has(path)) byPlayerPath.set(path, []);
      // Avoid duplicating an AFL-wide entry already covering this exact club context.
      const already = byPlayerPath.get(path).some((e) => e.note === `Club Database/Clubs/${clubName}`);
      if (!already) {
        byPlayerPath.get(path).push({
          desc: `Real club-level record/Best & Fairest history for ${clubName}`,
          note: `Club Database/Clubs/${clubName}`,
          anchor: `Club Database/Clubs/${clubName}#Club records`,
        });
      }
    }
  }

  for (const [path, entries] of byPlayerPath) {
    const fpath = `${PLAYERS_DIR}/${path}.md`;
    if (!existsSync(fpath)) {
      stats.playersSkipped++;
      continue;
    }
    let content = readFileSync(fpath, "utf-8");
    if (content.includes(MARKER)) {
      stats.playersSkipped++;
      continue;
    }
    const bullets = entries.map((e) => `- ${e.desc} — see [[${e.anchor}|${e.note === "Records" ? "Records" : e.note.split("/").pop()}]].`).join("\n");
    const section = `\n${MARKER}\n\n${bullets}\n`;
    const footerMatch = content.match(/\n---\nBack to \[\[Player Database\/Player Database/);
    if (footerMatch) {
      content = content.slice(0, footerMatch.index) + section + content.slice(footerMatch.index);
    } else {
      content = content.trimEnd() + "\n" + section;
    }
    writeFileSync(fpath, content);
    stats.playersEdited++;
  }

  // --- Coaches ---
  const byCoach = new Map();
  for (const [file, desc] of COACHES) {
    if (!byCoach.has(file)) byCoach.set(file, []);
    byCoach.get(file).push(desc);
  }
  for (const [file, descs] of byCoach) {
    const fpath = `${COACHES_DIR}/${file}.md`;
    if (!existsSync(fpath)) {
      stats.coachesSkipped++;
      continue;
    }
    let content = readFileSync(fpath, "utf-8");
    if (content.includes("## Real-world playing record")) {
      stats.coachesSkipped++;
      continue;
    }
    const bullets = descs.map((d) => `- ${d} — see [[Records]].`).join("\n");
    content = content.trimEnd() + `\n\n## Real-world playing record\n\n${bullets}\n`;
    writeFileSync(fpath, content);
    stats.coachesEdited++;
  }

  // --- Records.md: upgrade the 6 coaches' plain-text mentions to wikilinks pointing at their coach note ---
  let recordsContent = readFileSync(RECORDS_MD, "utf-8");
  const upgrades = [
    ["Bob Skilton (South Melbourne, 1959/1963/1968)", "[[Coaches Database/Coaches/Bob Skilton (Melbourne)|Bob Skilton]] (South Melbourne, 1959/1963/1968)"],
    ["Dick Reynolds (Essendon, 1934/1937/1938)", "[[Coaches Database/Coaches/Dick Reynolds (Essendon)|Dick Reynolds]] (Essendon, 1934/1937/1938)"],
    ["Ian Stewart (St Kilda 1965/1966, Richmond 1971", "[[Coaches Database/Coaches/Ian Stewart (Carlton)|Ian Stewart]] (St Kilda 1965/1966, Richmond 1971"],
    ["Below them on 2: Greg Williams, Robert Harvey,", "Below them on 2: Greg Williams, [[Coaches Database/Coaches/Robert Harvey (Collingwood)|Robert Harvey]],"],
    ["First-ever winner: Nathan Buckley (Brisbane Bears, 1993)", "First-ever winner: [[Coaches Database/Coaches/Nathan Buckley (Collingwood)|Nathan Buckley]] (Brisbane Bears, 1993)"],
    ["| 2012 | Sam Mitchell / Trent Cotchin (tied) |", "| 2012 | [[Coaches Database/Coaches/Sam Mitchell (Hawthorn)|Sam Mitchell]] / Trent Cotchin (tied) |"],
  ];
  let recordsEdits = 0;
  for (const [from, to] of upgrades) {
    if (recordsContent.includes(from) && !recordsContent.includes(to)) {
      recordsContent = recordsContent.replace(from, to);
      recordsEdits++;
    }
  }
  if (recordsEdits > 0) {
    writeFileSync(RECORDS_MD, recordsContent);
    stats.recordsMdEdited = true;
  }

  console.log(`Records: players edited ${stats.playersEdited} (skipped ${stats.playersSkipped}), coaches edited ${stats.coachesEdited} (skipped ${stats.coachesSkipped}), Records.md upgrades ${recordsEdits}`);
}

// ---------------------------------------------------------------------------
async function main() {
  ensureDir(`${VAULT}/Draft Prospects Database`);
  if (!existsSync(`${VAULT}/Draft Prospects Database/Draft Prospects Database.md`)) {
    writeFileSync(
      `${VAULT}/Draft Prospects Database/Draft Prospects Database.md`,
      [
        "---",
        "tags: [node, draft-prospects-database]",
        "---",
        "",
        "# Draft Prospects Database",
        "",
        "Back to [[AussieFootySim]]. Companion to [[Player Database/Player Database|Player Database]] —",
        "real and fictional draft PROSPECTS (not yet on any AFL list), one note per prospect currently in",
        "the live draft pool, each linked to its [[Player Database/Player Database|Archetype]] and to a",
        "Scouting Tier page. Sourced from `data/realProspects.ts` / `engine/draft.ts` — see",
        "[[Scouting Tiers and Predicted Draft Order]] for the full tiering mechanism.",
        "",
        "- [[Draft Prospects Database/2026 Draft Pool|2026 Draft Pool]] — the current 195-prospect pool",
        "- `Scouting Tiers/` — one note per tier (Generational Talent through Sub-par)",
      ].join("\n") + "\n"
    );
  }

  if (part === "players" || part === "all") await partPlayers();
  if (part === "tiers" || part === "all") partTiers();
  let heldByClubYear;
  if (part === "picks" || part === "all") heldByClubYear = await partPicks();
  if (part === "clubs" || part === "all") await partClubs(heldByClubYear);
  if (part === "records" || part === "all") partRecords();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
