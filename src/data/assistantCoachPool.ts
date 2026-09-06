import type { Coach } from "../types/coach.ts";
import { buildFictionalCoach, buildRealCoach, type FictionalCoachSeed, type RealCoachSeed } from "../engine/coachGrading.ts";

/**
 * Assistant Coaching System — see [[Assistant Coaching System]] (vault root) for the full design
 * note (research sourcing, grading methodology, stat-to-attribute mapping, grade ladder, scope
 * split). This file is the populated, graded talent pool Tyler asked for: "Can you research the
 * assistant coaches at each of the 18 clubs this year... Include these names into our coaching
 * talent pool database."
 *
 * FOUR SOURCE POOLS, exactly as Tyler asked for:
 *  1. `REAL_ASSISTANT_SEEDS` — real, currently-serving 2026 assistant coaches at all 18 clubs
 *     (research this round; coverage disclosed per-club below, not padded to look even).
 *  2. `REAL_CANDIDATE_SEEDS` — real people named in the 6 clubs' senior-coach searches Tyler asked
 *     about (North Melbourne, Essendon, Carlton, Melbourne, Gold Coast, Richmond) who are NOT
 *     already covered as a current assistant above.
 *  3. `HISTORICAL_SEEDS` — real, under-70 former senior/caretaker AFL coaches sourced from this
 *     project's OWN `realCoachHistory.ts` (round 74's 386-coach real ledger) wherever a ledger
 *     entry exists, cross-checked with real, well-known career facts (medals, flags) otherwise.
 *     POT === OVR for every one of these (Tyler: "older historical coaches have all reached their
 *     full potential").
 *  4. `FICTIONAL_SEEDS` — procedurally-graded young "graduate" talent, Tyler's own "superstar kids
 *     coming out of university with high potential" injection.
 *
 * A 5th bucket Tyler named — delisted/retired PLAYERS entering the pool — is a deliberate, disclosed
 * NON-population this round: `engine/contracts.ts`'s `delist()` is the real, live hook (see the
 * design note's "Sourcing" section), but wiring it up is follow-up work, not a static seed list.
 * The one live exception is Scott Pendlebury (`PENDING_PLAYER_COACH_SEED` below) — a real, dated,
 * already-signed player-coach transition, not a hypothetical, so it's seeded directly.
 *
 * NOT included, on purpose: anyone whose real 2026 job IS a senior coach right now — they're
 * employed at the top job, not available assistant talent. Concretely this excludes Josh Fraser
 * (promoted to Carlton's senior job mid-2026 after his caretaker spell — see the design note's own
 * account of his arc), Steven King (Melbourne's new senior coach), and every other currently-active
 * senior coach (Hardwick, Fagan, C. Scott, McRae, Beveridge, etc. — Fagan's contract status through
 * 2027 confirmed by live search this round, not assumed).
 *
 * GROUNDING: every real person below with a real senior/caretaker AFL coaching stint has that
 * ledger cross-checked directly against `realCoachHistory.ts`'s own round-74 dataset (win/loss
 * record, premierships, Grand Finals) rather than restated from memory — several turned up real,
 * precise, useful detail during that cross-check (e.g. Josh Fraser's real 82% Carlton caretaker
 * win rate confirming the design note's "turned the club's form around" account; Brendon Lade's
 * perfect 1-0 St Kilda caretaker game in 2022; Jaymie Graham's undefeated 3-0 record across two
 * real caretaker stints). Where no ledger entry exists (most current assistants — a real coaching
 * CV without ever having held senior/caretaker minutes is entirely normal), the bio relies on
 * generally well-known real career facts (medals, premierships, games) instead, and stays
 * deliberately light on unverifiable specifics like exact game tallies.
 *
 * Every OVR/POT number is produced by `engine/coachGrading.ts`'s deterministic, seeded
 * tier -> band mapping — nothing below is a hand-typed rating.
 */

// ---------------------------------------------------------------------------
// 1. REAL, CURRENTLY-SERVING 2026 ASSISTANT COACHES — all 18 clubs
// ---------------------------------------------------------------------------

const REAL_ASSISTANT_SEEDS: RealCoachSeed[] = [
  // Adelaide — club's own site/coverage doesn't individually break down these 3 titles this round;
  // role assigned from each man's own real playing background instead, per Tyler's own "roles they
  // played if they are former AFL players" instruction. Disclosed via "role-inferred" tag.
  {
    name: "Scott Burns", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Real 2010 Collingwood premiership player and All-Australian; Adelaide assistant, specific line title not individually confirmed this round.",
    currentAffiliation: "Assistant Coach, Adelaide", tags: ["assistant", "team/adelaide", "role-inferred"],
  },
  {
    name: "Nathan van Berlo", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Real Adelaide captain and 3x Malcolm Blight Medallist (club champion); Adelaide assistant, specific line title not individually confirmed this round.",
    currentAffiliation: "Assistant Coach, Adelaide", tags: ["assistant", "team/adelaide", "role-inferred"],
  },
  {
    name: "Darren Milburn", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Real 2x Geelong premiership defender (2007, 2009); Adelaide assistant, specific line title not individually confirmed this round.",
    currentAffiliation: "Assistant Coach, Adelaide", tags: ["assistant", "team/adelaide", "role-inferred"],
  },

  // Brisbane Lions
  {
    name: "Cameron Bruce", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Real Melbourne midfielder and best-and-fairest winner; Brisbane Lions assistant, specific line title not individually confirmed this round.",
    currentAffiliation: "Assistant Coach, Brisbane Lions", tags: ["assistant", "team/brisbane-lions", "role-inferred"],
  },
  {
    name: "Dale Morris", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Real 2016 Western Bulldogs premiership defender; Brisbane Lions assistant, specific line title not individually confirmed this round.",
    currentAffiliation: "Assistant Coach, Brisbane Lions", tags: ["assistant", "team/brisbane-lions", "role-inferred"],
  },
  {
    name: "Daniel Lloyd", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "Brisbane Lions forward-line assistant, promoted from the club's development staff.",
    currentAffiliation: "Forward Line Coach, Brisbane Lions", tags: ["assistant", "team/brisbane-lions"],
  },

  // Carlton (Josh Fraser excluded — promoted to senior coach mid-2026, see file doc comment)
  {
    name: "Leigh Adams", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Carlton midfield coach.", currentAffiliation: "Midfield Coach, Carlton", tags: ["assistant", "team/carlton"],
  },
  {
    name: "Ash Hansen", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Carlton defence coach.", currentAffiliation: "Defence Coach, Carlton", tags: ["assistant", "team/carlton"],
  },
  {
    name: "Damian Truslove", source: "real-assistant", primaryRole: "Development", tier: "Rising", atPotential: false,
    bio: "Carlton VFL/development coach.", currentAffiliation: "VFL/Development Coach, Carlton", tags: ["assistant", "team/carlton", "vfl-level"],
  },

  // Collingwood
  {
    name: "Tyson Goldsack", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "Real 2010 Collingwood premiership defender, now the club's forward-line assistant.",
    currentAffiliation: "Forward Line Coach, Collingwood", tags: ["assistant", "team/collingwood"],
  },
  {
    name: "Jordan Roughead", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Real 2016 Western Bulldogs premiership defender, now Collingwood's backline coach.",
    currentAffiliation: "Backline Coach, Collingwood", tags: ["assistant", "team/collingwood"],
  },
  {
    name: "Matthew Boyd", source: "real-assistant", primaryRole: "Midfield", tier: "Legend", atPotential: false,
    bio: "Real multi-time Western Bulldogs best-and-fairest winner and club great, now Collingwood's midfield coach.",
    currentAffiliation: "Midfield Coach, Collingwood", tags: ["assistant", "team/collingwood"],
  },
  {
    name: "Greg Stafford", source: "real-assistant", primaryRole: "Ruck and Stoppage", tier: "Established", atPotential: false,
    bio: "Collingwood ruck coach.", currentAffiliation: "Ruck Coach, Collingwood", tags: ["assistant", "team/collingwood"],
  },
  {
    name: "Hayden Skipworth", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Collingwood's Head of Football Strategy & Coaching, overseeing player development; also canvassed as a Melbourne and Carlton senior-coaching candidate in 2026.",
    currentAffiliation: "Head of Football Strategy & Coaching, Collingwood", tags: ["assistant", "team/collingwood", "senior-candidate-2026"],
  },

  // Essendon — Dean Solomon is the real, publicly-confirmed caretaker after Brad Scott's May 2026
  // sacking; he has ruled himself out of the permanent job. His own realCoachHistory.ts ledger (GC,
  // ES, 2017-2026, 1-0-14, 6.67%) shows a real prior caretaker stint at Gold Coast too.
  {
    name: "Dean Solomon", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Essendon caretaker senior coach since Brad Scott's May 2026 sacking (has publicly ruled himself out of the permanent job); also had a real, brief Gold Coast caretaker stint in 2017.",
    currentAffiliation: "Caretaker Senior Coach, Essendon (2026)", tags: ["assistant", "team/essendon", "caretaker-senior-coach-2026"],
  },

  // Fremantle — Jaymie Graham is also a real Essendon AND North Melbourne senior-search candidate
  // this round; realCoachHistory.ts confirms a real, undefeated 3-0 caretaker ledger across West
  // Coast and Fremantle (2018-2022).
  {
    name: "Jaymie Graham", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Fremantle assistant with a real, undefeated 3-0 caretaker record across West Coast and Fremantle (2018-2022); a live 2026 senior-coaching candidate at both Essendon and North Melbourne.",
    currentAffiliation: "Assistant Coach, Fremantle", tags: ["assistant", "team/fremantle", "senior-candidate-2026"],
  },

  // Geelong — Nathan Buckley joined 2026; realCoachHistory.ts confirms his real Collingwood senior
  // tenure (2012-2021, 0 premierships, 1 Grand Final).
  {
    name: "Nathan Buckley", source: "real-assistant", primaryRole: "Midfield", tier: "Legend", atPotential: false,
    secondaryTierRoles: ["Development"],
    bio: "Real Brownlow Medallist and Collingwood premiership captain (1990 flag as a teammate); senior-coached Collingwood 2012-2021 (1 Grand Final, no flag). Joined Geelong's assistant panel in 2026 after runner-up finishes in both Melbourne's and Carlton's 2026 senior-coach searches.",
    currentAffiliation: "Assistant Coach, Geelong", tags: ["assistant", "team/geelong", "senior-candidate-2026"],
  },
  {
    name: "James Rahilly", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "Geelong forward-line coach; real 2023 AFLCA Assistant Coach of the Year. Also a 2026 North Melbourne senior-coaching candidate.",
    currentAffiliation: "Forward Line Coach, Geelong", tags: ["assistant", "team/geelong", "senior-candidate-2026"],
  },
  {
    name: "James Kelly", source: "real-assistant", primaryRole: "Development", tier: "Legend", atPotential: false,
    bio: "Real multi-flag Geelong premiership player (2007, 2009, 2011); Geelong development coach and a 2026 Melbourne senior-coaching candidate.",
    currentAffiliation: "Development Coach, Geelong", tags: ["assistant", "team/geelong", "senior-candidate-2026"],
  },
  {
    name: "Nigel Lappin", source: "real-assistant", primaryRole: "Development", tier: "Legend", atPotential: false,
    bio: "Real 3x Brisbane Lions premiership player (2001-2003); Geelong development coach.",
    currentAffiliation: "Development Coach, Geelong", tags: ["assistant", "team/geelong"],
  },

  // Gold Coast (Scott Pendlebury's future move seeded separately below)
  {
    name: "Shaun Grigg", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Real 2017 Richmond premiership player, now Gold Coast's midfield coach.",
    currentAffiliation: "Midfield Coach, Gold Coast", tags: ["assistant", "team/gold-coast"],
  },
  {
    name: "Josh Drummond", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Gold Coast defence & tackling coach.", currentAffiliation: "Defence Coach, Gold Coast", tags: ["assistant", "team/gold-coast"],
  },

  // GWS
  {
    name: "Brett Montgomery", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "GWS generalist assistant, 4th season on the panel; also canvassed as a 2026 Carlton senior-coaching candidate.",
    currentAffiliation: "Assistant Coach, GWS", tags: ["assistant", "team/gws", "senior-candidate-2026"],
  },
  {
    name: "Ben Hart", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    secondaryTierRoles: ["Midfield"],
    bio: "GWS backline coach, moved from a midfield-coaching brief.",
    currentAffiliation: "Backline Coach, GWS", tags: ["assistant", "team/gws"],
  },
  {
    name: "Craig Jennings", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "GWS midfield/transition coach.", currentAffiliation: "Midfield Coach, GWS", tags: ["assistant", "team/gws"],
  },

  // Hawthorn — the most fully-documented club this round
  {
    name: "Kade Simpson", source: "real-assistant", primaryRole: "Defensive Line", tier: "Legend", atPotential: false,
    bio: "Real Carlton games-record holder and club great, now Hawthorn's backline coach.",
    currentAffiliation: "Backline Coach, Hawthorn", tags: ["assistant", "team/hawthorn"],
  },
  {
    name: "Adrian Hickmott", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "Hawthorn forwards coach.", currentAffiliation: "Forwards Coach, Hawthorn", tags: ["assistant", "team/hawthorn"],
  },
  {
    name: "David Mackay", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Real long-serving Adelaide midfielder, now Hawthorn's midfield coach.",
    currentAffiliation: "Midfield Coach, Hawthorn", tags: ["assistant", "team/hawthorn"],
  },
  {
    name: "David Hale", source: "real-assistant", primaryRole: "Ruck and Stoppage", tier: "Legend", atPotential: false,
    bio: "Real dual-premiership ruckman (Hawthorn 2013/2014, North Melbourne earlier); now Hawthorn's structure & opposition coach.",
    currentAffiliation: "Structure & Opposition Coach, Hawthorn", tags: ["assistant", "team/hawthorn"],
  },
  {
    name: "Daniel Giansiracusa", source: "real-assistant", primaryRole: "Development", tier: "Legend", atPotential: false,
    bio: "Real Western Bulldogs club great; Hawthorn's Head of Development, and a name canvassed across the 2026 Melbourne, Carlton and (2023) Richmond senior-coach processes.",
    currentAffiliation: "Head of Development, Hawthorn", tags: ["assistant", "team/hawthorn", "senior-candidate-2026"],
  },
  {
    name: "Brett Ratten", source: "real-assistant", primaryRole: "Development", tier: "Legend", atPotential: false,
    secondaryTierRoles: ["Midfield"],
    bio: "Real former senior coach at both Carlton and St Kilda (also a brief North Melbourne stint) — realCoachHistory.ts records a combined 94-1-103 senior/caretaker ledger, no flag. Now Hawthorn's Head of Coaching Performance & Development.",
    currentAffiliation: "Head of Coaching Performance & Development, Hawthorn", tags: ["assistant", "team/hawthorn"],
  },

  // Melbourne (Steven King excluded — appointed senior coach 2026)
  {
    name: "Troy Chaplin", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "Melbourne forwards coach; realCoachHistory.ts records a real, brief 2025 caretaker stint (0 wins from 3 games) before Steven King's appointment.",
    currentAffiliation: "Forwards Coach, Melbourne", tags: ["assistant", "team/melbourne"],
  },
  {
    name: "Jared Rivers", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Real long-serving Melbourne defender, newly appointed as the club's backline coach.",
    currentAffiliation: "Backline Coach, Melbourne", tags: ["assistant", "team/melbourne"],
  },
  {
    name: "Nathan Jones", source: "real-assistant", primaryRole: "Midfield", tier: "Legend", atPotential: false,
    bio: "Real Melbourne champion, multiple best-and-fairest winner and former captain; now the club's midfield coach.",
    currentAffiliation: "Midfield Coach, Melbourne", tags: ["assistant", "team/melbourne"],
  },
  {
    name: "Rory Atkins", source: "real-assistant", primaryRole: "Development", tier: "Rising", atPotential: false,
    bio: "Melbourne generalist assistant, newly appointed 2026.", currentAffiliation: "Assistant Coach, Melbourne", tags: ["assistant", "team/melbourne"],
  },
  {
    name: "Matthew Scarlett", source: "real-assistant", primaryRole: "Defensive Line", tier: "Legend", atPotential: false,
    bio: "Real 4x Geelong premiership defender; joined Melbourne's assistant panel in 2026 in a generalist capacity.",
    currentAffiliation: "Assistant Coach, Melbourne", tags: ["assistant", "team/melbourne"],
  },

  // North Melbourne (senior seat vacant Sep 2026 — see REAL_CANDIDATE_SEEDS)
  {
    name: "Xavier Clarke", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "North Melbourne forward-line coach, moved from the same role at Richmond in 2024; also part of Richmond's 2023 senior-coach succession discussions.",
    currentAffiliation: "Forward Line Coach, North Melbourne", tags: ["assistant", "team/north-melbourne"],
  },

  // Port Adelaide — new senior coach Josh Carr's rebuilt 2026 panel
  {
    name: "Stuart Dew", source: "real-assistant", primaryRole: "Midfield", tier: "Legend", atPotential: false,
    secondaryTierRoles: ["Development"],
    bio: "Real former Gold Coast senior coach (2018-2023, realCoachHistory.ts: 36-1-84, no finals); now Port Adelaide's senior assistant on midfield.",
    currentAffiliation: "Senior Assistant (Midfield), Port Adelaide", tags: ["assistant", "team/port-adelaide"],
  },
  {
    name: "Luke Webster", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "Port Adelaide defenders coach.", currentAffiliation: "Defenders Coach, Port Adelaide", tags: ["assistant", "team/port-adelaide"],
  },
  {
    name: "Darren Reeves", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "Port Adelaide forwards coach.", currentAffiliation: "Forwards Coach, Port Adelaide", tags: ["assistant", "team/port-adelaide"],
  },
  {
    name: "Hamish Hartlett", source: "real-assistant", primaryRole: "Ruck and Stoppage", tier: "Established", atPotential: false,
    bio: "Real long-serving Port Adelaide midfielder, now the club's stoppage/contest & opposition analysis coach.",
    currentAffiliation: "Stoppage & Opposition Coach, Port Adelaide", tags: ["assistant", "team/port-adelaide"],
  },
  {
    name: "Andy Collins", source: "real-assistant", primaryRole: "Talent Scout", tier: "Established", atPotential: false,
    secondaryTierRoles: ["Development"],
    bio: "Port Adelaide's director of coaching — a recruiting-adjacent oversight role, read here as primarily a Talent Scout aptitude rather than a general development one.",
    currentAffiliation: "Director of Coaching, Port Adelaide", tags: ["assistant", "team/port-adelaide"],
  },
  {
    name: "Matthew Lobbe", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    secondaryTierRoles: ["Ruck and Stoppage"],
    bio: "Real Port Adelaide ruckman, now the club's head of development.",
    currentAffiliation: "Head of Development, Port Adelaide", tags: ["assistant", "team/port-adelaide"],
  },

  // Richmond — no fully confirmed current assistant line-up found this round (disclosed gap, not
  // padded); the club's own most recent real senior-coach succession discussion was 2023, covered
  // under REAL_CANDIDATE_SEEDS (Chris Newman, Andrew McQualter) plus Giansiracusa/Clarke above.

  // St Kilda
  {
    name: "Jimmy Allan", source: "real-assistant", primaryRole: "Defensive Line", tier: "Established", atPotential: false,
    bio: "St Kilda's AFL-level backline coach.", currentAffiliation: "Backline Coach, St Kilda", tags: ["assistant", "team/st-kilda"],
  },
  {
    name: "Damian Carroll", source: "real-assistant", primaryRole: "Forward Line", tier: "Rising", atPotential: false,
    bio: "St Kilda VFL forwards coach.", currentAffiliation: "VFL Forwards Coach, St Kilda", tags: ["assistant", "team/st-kilda", "vfl-level"],
  },
  {
    name: "Lenny Hayes", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Real St Kilda champion and multi-time Trevor Barker Award (best-and-fairest) winner; currently the club's VFL midfield coach.",
    currentAffiliation: "VFL Midfield Coach, St Kilda", tags: ["assistant", "team/st-kilda", "vfl-level"],
  },

  // Sydney
  {
    name: "Amon Buchanan", source: "real-assistant", primaryRole: "Forward Line", tier: "Legend", atPotential: false,
    bio: "Real 2005 Sydney premiership player, now the club's forward line & ball movement coach.",
    currentAffiliation: "Forward Line & Ball Movement Coach, Sydney", tags: ["assistant", "team/sydney"],
  },
  {
    name: "Ben Matthews", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Sydney generalist assistant.", currentAffiliation: "Assistant Coach, Sydney", tags: ["assistant", "team/sydney"],
  },
  {
    name: "Jeremy Laidler", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Sydney generalist assistant.", currentAffiliation: "Assistant Coach, Sydney", tags: ["assistant", "team/sydney"],
  },
  {
    name: "Adam Kennedy", source: "real-assistant", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Sydney development coach.", currentAffiliation: "Development Coach, Sydney", tags: ["assistant", "team/sydney"],
  },
  {
    name: "Simon Goodwin", source: "real-assistant", primaryRole: "Development", tier: "Legend", atPotential: false,
    secondaryTierRoles: ["Midfield"],
    bio: "Real former Melbourne senior coach — led the club to its 2021 premiership (realCoachHistory.ts: 111-1-91, 1 flag from 1 Grand Final). Joined Sydney as Director of Coaching & Performance in Sep 2025; also discussed for Melbourne and Carlton's 2026 vacancies.",
    currentAffiliation: "Director of Coaching & Performance, Sydney", tags: ["assistant", "team/sydney", "senior-candidate-2026"],
  },

  // West Coast
  {
    name: "Sam Radford", source: "real-assistant", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "West Coast midfield coach.", currentAffiliation: "Midfield Coach, West Coast", tags: ["assistant", "team/west-coast"],
  },
  {
    name: "Marco Bello", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    bio: "West Coast forwards coach.", currentAffiliation: "Forwards Coach, West Coast", tags: ["assistant", "team/west-coast"],
  },
  {
    name: "Mitch Duncan", source: "real-assistant", primaryRole: "Defensive Line", tier: "Legend", atPotential: false,
    bio: "Real multi-flag Geelong premiership great, now West Coast's backs coach.",
    currentAffiliation: "Backs Coach, West Coast", tags: ["assistant", "team/west-coast"],
  },
  {
    name: "Luke Shuey", source: "real-assistant", primaryRole: "Ruck and Stoppage", tier: "Legend", atPotential: false,
    bio: "Real 2018 West Coast premiership best-afield and Norm Smith Medallist, now the club's stoppages coach.",
    currentAffiliation: "Stoppages Coach, West Coast", tags: ["assistant", "team/west-coast"],
  },
  {
    name: "Jamie Maddocks", source: "real-assistant", primaryRole: "Development", tier: "Rising", atPotential: false,
    bio: "West Coast development coach.", currentAffiliation: "Development Coach, West Coast", tags: ["assistant", "team/west-coast"],
  },

  // Western Bulldogs
  {
    name: "Ben Reid", source: "real-assistant", primaryRole: "Forward Line", tier: "Established", atPotential: false,
    secondaryTierRoles: ["Defensive Line"],
    bio: "Real Collingwood key defender, elevated to Western Bulldogs forward-line coach in 2026 after Matt Spangher's departure — a genuine cross-position appointment.",
    currentAffiliation: "Forward Line Coach, Western Bulldogs", tags: ["assistant", "team/western-bulldogs"],
  },
];

// ---------------------------------------------------------------------------
// 2. REAL SENIOR-COACH SEARCH CANDIDATES — the 6 clubs Tyler named, excluding
//    anyone already seeded above as a current real-assistant.
// ---------------------------------------------------------------------------

const REAL_CANDIDATE_SEEDS: RealCoachSeed[] = [
  {
    name: "Murray Davis", source: "real-candidate", primaryRole: "Talent Scout", tier: "Established", atPotential: false,
    secondaryTierRoles: ["Development"],
    bio: "Adelaide's coaching director — read here as primarily a Talent Scout aptitude; also a 2026 Essendon senior-coaching candidate.",
    currentAffiliation: "Coaching Director, Adelaide", tags: ["real-candidate", "essendon-search-2026"],
  },
  {
    name: "Mark McVeigh", source: "real-candidate", primaryRole: "Midfield", tier: "Established", atPotential: false,
    bio: "Real Essendon and Sydney forward/midfielder; a real GWS caretaker in 2022 (realCoachHistory.ts: 4-0-9, no finals). Currently a Sydney assistant, believed the front-runner for Essendon's 2026 vacancy.",
    currentAffiliation: "Assistant Coach, Sydney", tags: ["real-candidate", "essendon-search-2026"],
  },
  {
    name: "James Hird", source: "real-candidate", primaryRole: "Forward Line", tier: "Legend", atPotential: false,
    secondaryTierRoles: ["Development"],
    bio: "Real Brownlow Medallist, Norm Smith Medallist and 2000 Essendon premiership captain; senior-coached Essendon 2011-2015 (realCoachHistory.ts: 41-1-43, no flag). A 2026 Essendon candidate as a club legend.",
    tags: ["real-candidate", "essendon-search-2026", "historical-senior-coach"],
  },
  {
    name: "John Longmire", source: "real-candidate", primaryRole: "Forward Line", tier: "Legend", atPotential: false,
    bio: "Real North Melbourne key forward; senior-coached Sydney 2011-2024 to a real 2012 premiership (realCoachHistory.ts: 208-3-122, 62.91%, 1 flag from 5 Grand Finals). A 2026 candidate at both North Melbourne and Carlton.",
    tags: ["real-candidate", "north-melbourne-search-2026", "carlton-search-2026"],
  },
  {
    name: "Adam Simpson", source: "real-candidate", primaryRole: "Midfield", tier: "Legend", atPotential: false,
    bio: "Real North Melbourne inside midfielder; senior-coached West Coast 2014-2024 to a real 2018 premiership (realCoachHistory.ts: 122-1-119, 1 flag from 2 Grand Finals). A 2026 candidate at both North Melbourne and Carlton.",
    tags: ["real-candidate", "north-melbourne-search-2026", "carlton-search-2026"],
  },
  {
    name: "Ken Hinkley", source: "real-candidate", primaryRole: "Forward Line", tier: "Legend", atPotential: false,
    bio: "Real Geelong/Fitzroy forward; senior-coached Port Adelaide 2013-2025 (realCoachHistory.ts: 174-0-123, 58.59%, no flag). A 2026 Carlton candidate.",
    tags: ["real-candidate", "carlton-search-2026"],
  },
  {
    name: "Chris Newman", source: "real-candidate", primaryRole: "Defensive Line", tier: "Legend", atPotential: false,
    bio: "Real Richmond captain and club great; named among the alternatives to Adem Yze in Richmond's 2023 senior-coach succession discussion.",
    tags: ["real-candidate", "richmond-search-2023"],
  },
  {
    name: "Andrew McQualter", source: "real-candidate", primaryRole: "Development", tier: "Established", atPotential: false,
    bio: "Richmond development figure and 2023 caretaker senior coach; realCoachHistory.ts records a real, difficult senior/caretaker ledger across Richmond and West Coast (2023-2026, 12-0-47, 20.34%).",
    tags: ["real-candidate", "richmond-search-2023"],
  },
];

/**
 * Scott Pendlebury — Collingwood's current captain and the AFL's all-time games-record holder,
 * still an active player in our own Player Database. A real, confirmed four-year deal sees him
 * join Gold Coast from 2027: two seasons as a player-coach, then two contracted seasons as an
 * assistant under Damien Hardwick from 2029. Tyler's own "as players retire they enter the talent
 * pool" mechanic already playing out in real life for a name already in this game — seeded here as
 * a real, dated, clearly-labelled pending entry rather than folded anonymously into the general
 * assistant list.
 */
const PENDING_PLAYER_COACH_SEED: RealCoachSeed = {
  name: "Scott Pendlebury", source: "real-assistant", primaryRole: "Midfield", tier: "Legend", atPotential: false,
  bio: "Collingwood captain and the AFL's all-time games-record holder — still an active player in our Player Database. Real, confirmed 4-year deal: player-coach at Gold Coast from 2027, then a contracted assistant under Damien Hardwick from 2029.",
  currentAffiliation: "Active player, Collingwood (pending player-coach move to Gold Coast, 2027)",
  tags: ["pending", "player-coach", "team/gold-coast"],
};

// ---------------------------------------------------------------------------
// 3. HISTORICAL — real, under-70 former senior/caretaker AFL coaches. POT ===
//    OVR for every entry (Tyler: "older historical coaches have all reached
//    their full potential"). Cross-checked against realCoachHistory.ts's own
//    round-74 ledger wherever an entry exists (cited inline).
//
//    Deliberately EXCLUDED: every currently-active senior coach (not
//    "available"), and Neale Daniher — technically under 70 (65) but living
//    with a severe, well-known, ongoing motor neurone disease diagnosis since
//    2013. Not appropriate to model as available coaching talent; left out on
//    sensitivity grounds, not forgotten.
// ---------------------------------------------------------------------------

const HISTORICAL_SEEDS: RealCoachSeed[] = [
  {
    name: "Alastair Clarkson", source: "historical", primaryRole: "Development", tier: "Legend", atPotential: true,
    secondaryTierRoles: ["Midfield", "Talent Scout"],
    age: 58,
    bio: "Real 4x Hawthorn premiership senior coach (2008, 2013, 2014, 2015); realCoachHistory.ts's combined Hawthorn/North Melbourne ledger: 248-5-219 (53.07%), 4 flags from 5 Grand Finals. Sacked by North Melbourne in Sep 2026.",
    currentAffiliation: "Free agent (sacked by North Melbourne, Sep 2026)", tags: ["historical", "premiership-coach", "north-melbourne-search-2026"],
  },
  {
    name: "Michael Voss", source: "historical", primaryRole: "Midfield", tier: "Legend", atPotential: true,
    secondaryTierRoles: ["Development"],
    age: 51,
    bio: "Real Brisbane Lions premiership captain (2001-2003) and Brownlow Medallist as a player. Senior-coached Brisbane, then Carlton to 2026 (realCoachHistory.ts's combined ledger: 92-2-118, 43.87%, no flag). Departed Carlton in 2026 after a 1-8 start, before interim Josh Fraser turned the club's form around.",
    currentAffiliation: "Free agent (departed Carlton, 2026)", tags: ["historical", "carlton-search-2026"],
  },
  {
    name: "Brad Scott", source: "historical", primaryRole: "Development", tier: "Legend", atPotential: true,
    secondaryTierRoles: ["Defensive Line"],
    age: 51,
    bio: "Real North Melbourne (2010-2020) and Essendon (2023-2026) senior coach; realCoachHistory.ts's combined ledger: 135-1-155 (46.56%), no flag. Sacked by Essendon in May 2026.",
    currentAffiliation: "Free agent (sacked by Essendon, May 2026)", tags: ["historical", "essendon-search-2026"],
  },
  {
    name: "Mark Williams", source: "historical", primaryRole: "Development", tier: "Legend", atPotential: true,
    age: 68,
    bio: "Real Port Adelaide 2004 premiership senior coach (realCoachHistory.ts: 150-2-121, 55.31%, 1 flag from 2 Grand Finals). Most recently joined Hawthorn's AFLW program as Head of Development in 2026, after 15 seasons in assistant/development roles at GWS, Richmond and Melbourne.",
    currentAffiliation: "Head of Development, Hawthorn AFLW (2026)", tags: ["historical", "premiership-coach"],
  },
  {
    name: "Rodney Eade", source: "historical", primaryRole: "Midfield", tier: "Legend", atPotential: true,
    secondaryTierRoles: ["Development"],
    age: 68,
    bio: "Real Hawthorn best-and-fairest winner as a player; senior-coached Sydney, Western Bulldogs and Gold Coast 1996-2017 (realCoachHistory.ts: 185-5-187, 49.73%, no flag from 1 Grand Final). Long retired into AFL media commentary.",
    tags: ["historical"],
  },
  {
    name: "Paul Roos", source: "historical", primaryRole: "Defensive Line", tier: "Legend", atPotential: true,
    secondaryTierRoles: ["Development"],
    age: 64,
    bio: "Real dual Fitzroy/Sydney defender across a long playing career; senior-coached Sydney to a real 2005 premiership, then Melbourne (realCoachHistory.ts: 137-2-129, 51.49%, 1 flag from 2 Grand Finals). Long since a Fox Footy commentator.",
    tags: ["historical", "premiership-coach"],
  },
  {
    name: "Mark Thompson", source: "historical", primaryRole: "Development", tier: "Legend", atPotential: true,
    secondaryTierRoles: ["Forward Line"],
    age: 62,
    bio: "Real 1985 Essendon premiership player; senior-coached Geelong to real 2007 and 2009 flags, later an Essendon interim coach (realCoachHistory.ts: 173-4-106, 61.84%, 2 flags from 3 Grand Finals). Long since a media personality.",
    tags: ["historical", "premiership-coach"],
  },
  {
    name: "Terry Wallace", source: "historical", primaryRole: "Midfield", tier: "Established", atPotential: true,
    age: 67,
    bio: "Real Hawthorn and Footscray on-baller; senior-coached Western Bulldogs and Richmond 1996-2009 (realCoachHistory.ts: 116-4-127, 47.77%, no flag). Long since an AFL media commentator.",
    tags: ["historical"],
  },
  {
    name: "Brenton Sanderson", source: "historical", primaryRole: "Development", tier: "Established", atPotential: true,
    age: 53,
    bio: "Senior-coached Adelaide 2012-2014 (realCoachHistory.ts: 39-0-30, 56.52%, no flag). Since worked in AFL community umpiring administration and, as of 2023, as Director of Sport at Mentone Grammar — current 2026 status not confirmed by this round's research, so no current affiliation is asserted.",
    tags: ["historical"],
  },
  {
    name: "Brendon Lade", source: "historical", primaryRole: "Ruck and Stoppage", tier: "Legend", atPotential: true,
    bio: "Real 2004 Port Adelaide premiership ruckman; realCoachHistory.ts records a perfect, if brief, 1-0 senior/caretaker record at St Kilda in 2022. A 2026 Melbourne and Carlton senior-coaching candidate.",
    tags: ["historical", "melbourne-search-2026", "carlton-search-2026"],
  },
];

// ---------------------------------------------------------------------------
// 4. FICTIONAL — Tyler's "additional injection of young fictional made up
//    talent to simulate superstar kids coming out of university with high
//    potential." One per role, plus 2 extra to round out the depth chart, all
//    plainly fictional names/bios, never blended with the real data above.
// ---------------------------------------------------------------------------

const FICTIONAL_SEEDS: FictionalCoachSeed[] = [
  {
    name: "Isaac Bramwell", primaryRole: "Defensive Line",
    bio: "AFL Coaches Academy graduate; honours thesis on zone-defence spacing at Victoria University.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Marcus Ah Sam", primaryRole: "Defensive Line",
    bio: "Former state-league key defender turned full-time coaching graduate; rated a high-ceiling gamble by his AFLCA course convenor.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Priya Nathan", primaryRole: "Forward Line",
    bio: "Fast-tracked through the AFLCA's Level 3 pathway on the back of a data-driven set-shot coaching model built during her sports-science degree.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Lucy Beaumont", primaryRole: "Forward Line",
    bio: "Former VFLW forward pocket, now a graduate forward-line coach with a reputation for inventive set-shot routines.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Cody Ferrante", primaryRole: "Midfield",
    bio: "Former state-league midfielder turned full-time coaching graduate, mentored through his club's VFL program.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Kalani Ruwhiu", primaryRole: "Ruck and Stoppage",
    bio: "Ex-underage ruckman whose university thesis modelled stoppage craft; tipped as one to watch by his AFLCA course convenor.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Grace Oldfield", primaryRole: "Development",
    bio: "Exercise-science graduate specialising in adolescent athletic development, recruited straight from a talent-pathway internship.",
    tags: ["fictional", "graduate"],
  },
  {
    name: "Toby Windsor", primaryRole: "Talent Scout",
    bio: "List-management intern turned recruiting analyst; built a draft-projection model as a university capstone project that impressed several recruiting managers.",
    tags: ["fictional", "graduate"],
  },
];

// ---------------------------------------------------------------------------
// Assembled pool
// ---------------------------------------------------------------------------

const ALL_REAL_SEEDS: RealCoachSeed[] = [
  ...REAL_ASSISTANT_SEEDS,
  ...REAL_CANDIDATE_SEEDS,
  ...HISTORICAL_SEEDS,
  PENDING_PLAYER_COACH_SEED,
];

/** The full graded assistant-coaching talent pool — see this file's own doc comment for sourcing. */
export const ASSISTANT_COACH_POOL: Coach[] = [
  ...ALL_REAL_SEEDS.map((seed, i) => buildRealCoach(seed, i + 1)),
  ...FICTIONAL_SEEDS.map((seed, i) => buildFictionalCoach(seed, i + 1 + ALL_REAL_SEEDS.length)),
];
