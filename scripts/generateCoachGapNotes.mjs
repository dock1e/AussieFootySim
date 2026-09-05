// Gap-filling generator: creates a Coaches Database note ONLY for a (coach, club) tenure that
// doesn't already have a file. Never overwrites an existing note — the existing per-club notes
// were sourced from each club's own individual afltables coaching ledger page and are MORE
// precise (genuine per-club win/loss splits) than this script's source data (a single combined-
// career row per coach from the "AFL Coaches Database" summary sheet). Placeholder notes this
// script creates are clearly labelled as combined-career figures, not a per-club split, so nobody
// mistakes them for the richer kind later.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const VAULT = "/sessions/modest-wizardly-ritchie/mnt/AussieFootySim";
const COACH_DIR = `${VAULT}/Coaches Database/Coaches`;

// Inline copy of realCoachHistory.ts's RAW table + club code map (kept in sync by hand — this is
// a one-off vault-gap-filling utility, not part of the app build).
const CLUB_CODE_MAP = {
  AD: "Adelaide", BL: "Brisbane Lions", BB: "Brisbane Lions", CA: "Carlton", CW: "Collingwood",
  ES: "Essendon", FR: "Fremantle", GE: "Geelong", GC: "Gold Coast", GW: "Greater Western Sydney",
  HW: "Hawthorn", ME: "Melbourne", NM: "North Melbourne", KA: "North Melbourne", PA: "Port Adelaide",
  RI: "Richmond", SK: "St Kilda", SY: "Sydney", SM: "Sydney", WC: "West Coast", WB: "Western Bulldogs",
  FO: "Western Bulldogs", FI: null, UN: null,
};
const CLUB_SLUG = {
  "Adelaide": "adelaide", "Brisbane Lions": "brisbane-lions", "Carlton": "carlton",
  "Collingwood": "collingwood", "Essendon": "essendon", "Fremantle": "fremantle",
  "Geelong": "geelong", "Gold Coast": "gold-coast", "Greater Western Sydney": "greater-western-sydney",
  "Hawthorn": "hawthorn", "Melbourne": "melbourne", "North Melbourne": "north-melbourne",
  "Port Adelaide": "port-adelaide", "Richmond": "richmond", "St Kilda": "st-kilda",
  "Sydney": "sydney", "West Coast": "west-coast", "Western Bulldogs": "western-bulldogs",
};

const raw = JSON.parse(readFileSync(new URL("./coachRawData.json", import.meta.url)));

function fileNameFor(name, club) {
  // "Last, First" -> "First Last (Club).md"
  const [last, first] = name.split(", ");
  return `${first} ${last} (${club}).md`;
}

let created = 0;
let skippedExisting = 0;
let skippedDefunct = 0;
const createdList = [];

for (const row of raw) {
  const [name, clubCodes, seasons, haW, haD, haL, haT, haPct, fW, fD, fL, fT, fPct, tW, tD, tL, tT, tPct, PR, GF] = row;
  for (const code of clubCodes) {
    const club = CLUB_CODE_MAP[code];
    if (!club) { skippedDefunct++; continue; }
    const fname = fileNameFor(name, club);
    const fpath = `${COACH_DIR}/${fname}`;
    if (existsSync(fpath)) { skippedExisting++; continue; }
    const [first, ...lastParts] = name.split(", ").reverse();
    const displayName = `${first} ${name.split(", ")[0]}`;
    const slug = CLUB_SLUG[club] ?? club.toLowerCase().replace(/\s+/g, "-");
    const body = `---
tags: [coach, team/${slug}]
---

# ${displayName}

Back to [[Coaches Database]] · [[Club Database/Clubs/${club}|${club}]].

**${club}, ${seasons} (combined career span across all clubs coached).** Combined career record
across ${clubCodes.length > 1 ? "all clubs coached: " + clubCodes.map((c) => CLUB_CODE_MAP[c] ?? c).join(", ") : club + " only"}:
${tW}-${tD}-${tL} (${tPct}% win rate), ${PR} premiership${PR === 1 ? "" : "s"}, ${GF} Grand Final${GF === 1 ? "" : "s"} coached.

**Placeholder note — not yet split per-club.** Sourced from the "AFL Coaches Database" combined-
career summary sheet, not an individual per-club afltables ledger page. If this coach's other
club-tenures already have their own richer, per-club-specific notes elsewhere in this database,
prefer those numbers over this one — this note exists to close a coverage gap, not to override a
more precise figure. Replace with a genuine per-club split (afltables' own per-club coaching
ledger, e.g. afltables.com/afl/stats/coaches/<club>.html) when available.
`;
    writeFileSync(fpath, body, "utf8");
    created++;
    createdList.push(fname);
  }
}

console.log(JSON.stringify({ created, skippedExisting, skippedDefunct, createdList }, null, 2));
