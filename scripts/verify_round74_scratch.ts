/**
 * Round 74 (draft-pick inventory, engine/draftPicks.ts) verification —
 * throwaway, matches the project's established verify_roundNN_scratch.ts
 * convention. Runs against the real seed data extracted from Tyler's "AFL
 * 2026 Players DB" workbook's 'AFL Draft Picks' tab.
 */
import { CLUBS, clubByName } from "../src/types/club.ts";
import {
  REAL_PICKS_2026,
  REAL_FUTURE_PICKS_2027,
  REAL_FUTURE_PICKS_2028,
  seedDraftPickInventory,
  dviValueForPick,
  dviValueForFuturePick,
  picksOwnedBy,
  totalPickValue,
  transferPick,
  resolveDraftOrder,
} from "../src/engine/draftPicks.ts";

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

console.log("=== Section 1: 2026 numbered picks -- real spot checks against the source sheet ===");
function pick2026(n: number) {
  return REAL_PICKS_2026.find((p) => p.pickNumber === n);
}
check("Essendon holds real pick 1", pick2026(1)?.currentClubId === clubByName("Essendon")?.ClubID);
check("Adelaide holds real pick 13", pick2026(13)?.currentClubId === clubByName("Adelaide")?.ClubID);
check("Adelaide holds real pick 31", pick2026(31)?.currentClubId === clubByName("Adelaide")?.ClubID);
check("Adelaide holds real pick 49", pick2026(49)?.currentClubId === clubByName("Adelaide")?.ClubID);
check("Gold Coast holds real pick 60 (their only 2026 pick)", pick2026(60)?.currentClubId === clubByName("Gold Coast")?.ClubID);
check("pick 37 is genuinely absent (disclosed gap, not guessed)", pick2026(37) === undefined);
check("pick 42 is genuinely absent (disclosed gap, not guessed)", pick2026(42) === undefined);
check("pick 58 is genuinely absent (disclosed gap, not guessed)", pick2026(58) === undefined);
check("exactly 69 of 72 2026 picks are tracked", REAL_PICKS_2026.length === 69, `got ${REAL_PICKS_2026.length}`);
check("no duplicate 2026 pick numbers", new Set(REAL_PICKS_2026.map((p) => p.pickNumber)).size === REAL_PICKS_2026.length);
check("every 2026 pick number is in 1..72", REAL_PICKS_2026.every((p) => p.pickNumber! >= 1 && p.pickNumber! <= 72));
check("every 2026 pick's round matches ceil(pickNumber/18)", REAL_PICKS_2026.every((p) => p.round === Math.ceil(p.pickNumber! / 18)));

console.log("=== Section 2: 2027/2028 future picks -- real trade-lineage spot checks ===");
function future(list: typeof REAL_FUTURE_PICKS_2027, origClub: string, round: number) {
  return list.find((p) => p.originalClubId === clubByName(origClub)!.ClubID && p.round === round);
}
check("Carlton's real 2027 R2 is now held by Sydney (structured list, not the stale prose note)", future(REAL_FUTURE_PICKS_2027, "Carlton", 2)?.currentClubId === clubByName("Sydney")?.ClubID);
check("Gold Coast's real 2027 R3 is now held by Melbourne (Petracca trade)", future(REAL_FUTURE_PICKS_2027, "Gold Coast", 3)?.currentClubId === clubByName("Melbourne")?.ClubID);
check("Melbourne's real 2027 R3 is now held by St Kilda", future(REAL_FUTURE_PICKS_2027, "Melbourne", 3)?.currentClubId === clubByName("St Kilda")?.ClubID);
check("Melbourne's real 2027 R4 is now held by St Kilda", future(REAL_FUTURE_PICKS_2027, "Melbourne", 4)?.currentClubId === clubByName("St Kilda")?.ClubID);
check("Sydney's own 2027 R1 is genuinely untracked (disclosed gap)", future(REAL_FUTURE_PICKS_2027, "Sydney", 1) === undefined);
check("St Kilda's own 2027 R4 is genuinely untracked (disclosed gap)", future(REAL_FUTURE_PICKS_2027, "St Kilda", 4) === undefined);
check("2027 has exactly 70 tracked round-level entries", REAL_FUTURE_PICKS_2027.length === 70, `got ${REAL_FUTURE_PICKS_2027.length}`);
check("2028 is a clean, complete 72/72 (no real trades that far out yet)", REAL_FUTURE_PICKS_2028.length === 72, `got ${REAL_FUTURE_PICKS_2028.length}`);
check("2028 has every entry as an identity mapping (original === current)", REAL_FUTURE_PICKS_2028.every((p) => p.originalClubId === p.currentClubId));
check("no Tasmania Devils entries leaked into either future array (no ClubID for them yet)", ![...REAL_FUTURE_PICKS_2027, ...REAL_FUTURE_PICKS_2028].some((p) => !CLUBS.some((c) => c.ClubID === p.originalClubId) || !CLUBS.some((c) => c.ClubID === p.currentClubId)));

console.log("=== Section 3: DVI value curve -- anchored at the 2 real published points ===");
check("pick 1 DVI value is exactly 3000 (real published anchor)", dviValueForPick(1) === 3000, `got ${dviValueForPick(1)}`);
check("pick 54 DVI value is exactly 14 (real published anchor)", dviValueForPick(54) === 14, `got ${dviValueForPick(54)}`);
check("pick 55 DVI value is 0 (real: points terminate at 54)", dviValueForPick(55) === 0);
check("pick 72 DVI value is 0", dviValueForPick(72) === 0);
check("value strictly decreases from pick 1 to pick 54", (() => {
  for (let p = 1; p < 54; p++) if (dviValueForPick(p) <= dviValueForPick(p + 1)) return false;
  return true;
})());
check("a future (unnumbered) round-1 pick prices as the average of real picks 1-18", dviValueForFuturePick(1) === Math.round([...Array(18)].reduce((s, _, i) => s + dviValueForPick(i + 1), 0) / 18));

console.log("=== Section 4: ownership/value/transfer helpers ===");
const seeded = seedDraftPickInventory();
check("seedDraftPickInventory concatenates all 3 real years", seeded.length === REAL_PICKS_2026.length + REAL_FUTURE_PICKS_2027.length + REAL_FUTURE_PICKS_2028.length);
const adelaideId = clubByName("Adelaide")!.ClubID;
const adelaide2026 = picksOwnedBy(seeded, adelaideId, 2026);
check("Adelaide's 2026 inventory view returns exactly their 3 real picks", adelaide2026.length === 3, `got ${adelaide2026.length}`);
check("Adelaide's total 2026 pick value is the sum of picks 13/31/49's DVI values", totalPickValue(seeded, adelaideId, 2026) === dviValueForPick(13) + dviValueForPick(31) + dviValueForPick(49));

const someSydneyPick = REAL_PICKS_2026.find((p) => p.pickNumber === 35)!; // Sydney's real own pick 35
const afterTransfer = transferPick(seeded, someSydneyPick.id, adelaideId);
check("transferPick moves exactly the targeted pick and nothing else", afterTransfer.find((p) => p.id === someSydneyPick.id)?.currentClubId === adelaideId && afterTransfer.filter((p, i) => p !== seeded[i] && p.id !== someSydneyPick.id).length === 0);
check("transferPick does not mutate the original array (pure)", seeded.find((p) => p.id === someSydneyPick.id)?.currentClubId === clubByName("Sydney")?.ClubID);
check("transferPick is a no-op for an unknown pick id", transferPick(seeded, "not-a-real-id", adelaideId).every((p, i) => p === seeded[i]));

console.log("=== Section 5: resolveDraftOrder -- the actual mechanic Tyler asked for ===");
const ladder = CLUBS.map((c, i) => ({ clubId: c.ClubID, played: 22, wins: CLUBS.length - i, losses: i, draws: 0, pointsFor: 0, pointsAgainst: 0, premiershipPoints: (CLUBS.length - i) * 4, percentage: 100 }));
// Reverse ladder (worst record first) is the natural round-1 order — Essendon
// is seeded last in `ladder` (weakest), so naturally on the clock first.
const order2026 = resolveDraftOrder(seeded, 2026, ladder, 4);
check("resolveDraftOrder returns 72 slots for 4 real rounds", order2026.length === 72, `got ${order2026.length}`);
check("pick 1 of the resolved order is Essendon (real 2026 hand), not whichever club naturally finished last", order2026[0] === "Essendon");
check("pick 13 of the resolved order is Adelaide (real, traded-for pick), not the natural 13th-worst club", order2026[12] === "Adelaide");
check("pick 60 of the resolved order is Gold Coast (real, their only 2026 pick)", order2026[59] === "Gold Coast");
// Slot 37 (round 3, pick 1) has no real numbered-pick entry -- must fall back
// to the natural reverse-ladder club for that exact ladder position.
const naturalRound3Pick1 = [...ladder].reverse()[0]; // worst-ladder club, same club natural round-1-pick-1 too
const naturalClubName37 = CLUBS.find((c) => c.ClubID === naturalRound3Pick1.clubId)!.name;
check("the disclosed gap slot (pick 37) falls back to the natural reverse-ladder club", order2026[36] === naturalClubName37);

const order2027 = resolveDraftOrder(seeded, 2027, ladder, 4);
check("resolveDraftOrder also produces 72 slots for the 2027 future year", order2027.length === 72);
// Carlton's natural round-2 slot (2nd-worst club) should resolve to Sydney,
// since Carlton's real 2027 R2 entitlement was traded to Sydney.
const reversedLadder = [...ladder].reverse();
const carltonLadderIdx = reversedLadder.findIndex((r) => r.clubId === clubByName("Carlton")!.ClubID);
check("Carlton's natural 2027 R2 slot resolves to Sydney, the real current owner", order2027[18 + carltonLadderIdx] === "Sydney");

console.log("=== Section 6: empty-inventory fallback -- a pre-round-74 save must behave identically to before ===");
const emptyOrder2026 = resolveDraftOrder([], 2026, ladder, 4);
const naturalOrderOnly: string[] = [];
for (let r = 0; r < 4; r++) naturalOrderOnly.push(...reversedLadder.map((row) => CLUBS.find((c) => c.ClubID === row.clubId)!.name));
check("an empty inventory produces the exact naive natural reverse-ladder order (old buildDraftOrder behaviour)", JSON.stringify(emptyOrder2026) === JSON.stringify(naturalOrderOnly));

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
