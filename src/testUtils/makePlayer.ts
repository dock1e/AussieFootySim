import { DISCRETE_SKILLS, type Player } from "../types/player.ts";

/**
 * Builds a minimally-valid Player for tests, every rated attribute
 * defaulted to 50 (league average, see Configuration.md "Rating scale") so
 * a test only has to specify the fields it actually cares about.
 */
export function makePlayer(overrides: Partial<Player> = {}): Player {
  const impDeg: Record<string, number> = {};
  for (const skill of DISCRETE_SKILLS) {
    impDeg[`imp_${skill}`] = 50;
    impDeg[`deg_${skill}`] = 10;
  }

  const base: Player = {
    PlayerID: 999999,
    Team: "Test FC",
    OriginClub: "Test FC",
    ClubID: 0,
    fname: "Test",
    lname: "Player",
    homeState: "VIC",
    height: 185,
    weight: 85,
    Age: 24,
    age_day: 1,
    age_month: 1,
    age_year: 2002,
    condition: 90,

    manMarking: 50,
    verticalLeap: 50,
    tenacity: 50,
    skill: 50,
    agility: 50,
    courage: 50,
    aggression: 50,
    xFactor: 50,
    strengthGroundLevel: 50,
    strengthOverhead: 50,
    strengthManOnMan: 50,
    acceleration: 50,
    speed: 50,
    endurance: 50,
    confidence: 50,
    readPlay: 50,
    consistancy: 50,
    positioning: 50,
    copeWithPressure: 50,
    potentialTall: 50,
    potentialMid: 50,
    kickMaxDistance: 50,

    diciplineMatch: 50,
    disciplineTraining: 50,
    disiciplineOffFirned: 50,
    umpireLikes: 50,
    umpireNotice: 50,
    goHomeTend: 50,
    injuryTend: 20,
    loyaltyTend: 50,
    clangerTend: 50,
    leadership: 50,

    ...(impDeg as Player),

    totalValue: 500000,
    jumperNumber: 1,
    signed_day: 1,
    signed_month: 1,
    signed_year: 2024,
    expired_day: 1,
    expired_month: 1,
    expired_year: 2027,
    draft_pick: 50,
    draft_year: 2020,
    draft_draftType: "National Draft",

    archetype: "Inside Mid",
    archetype_reason: "test fixture",

    stat_GM: 20,
    stat_DI: 400,
    stat_KI: 250,
    stat_HB: 150,
    stat_MK: 60,
    stat_TK: 60,
    stat_CL: 40,
    stat_GL: 10,
    stat_HO: 0,
    stat_CM: 5,
    stat_CP: 150,
    stat_UP: 250,
    stat_1pct: 20,

    OVR: 50,
    POT: 55,
  };

  return { ...base, ...overrides };
}
