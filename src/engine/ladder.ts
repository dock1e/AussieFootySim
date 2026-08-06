/**
 * Ladder / standings computation — standard real-AFL rules: 4 premiership
 * points for a win, 2 for a draw, 0 for a loss; sorted by premiership points
 * then percentage (points for / points against * 100).
 */

export interface MatchOutcome {
  homeClubId: number;
  awayClubId: number;
  homePoints: number;
  awayPoints: number;
}

export interface LadderRow {
  clubId: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  premiershipPoints: number;
  percentage: number;
}

function emptyRow(clubId: number): LadderRow {
  return {
    clubId,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    premiershipPoints: 0,
    percentage: 0,
  };
}

/** Computes the ladder for a set of clubs from whatever results have been played so far (a partial season is fine — clubs with 0 games played just sit at 0/0/0/0%). */
export function computeLadder(clubIds: number[], results: MatchOutcome[]): LadderRow[] {
  const rows = new Map<number, LadderRow>(clubIds.map((id) => [id, emptyRow(id)]));

  for (const r of results) {
    const home = rows.get(r.homeClubId);
    const away = rows.get(r.awayClubId);
    if (!home || !away) continue; // ignore results for clubs outside this ladder's scope

    home.played += 1;
    away.played += 1;
    home.pointsFor += r.homePoints;
    home.pointsAgainst += r.awayPoints;
    away.pointsFor += r.awayPoints;
    away.pointsAgainst += r.homePoints;

    if (r.homePoints > r.awayPoints) {
      home.wins += 1;
      away.losses += 1;
      home.premiershipPoints += 4;
    } else if (r.awayPoints > r.homePoints) {
      away.wins += 1;
      home.losses += 1;
      away.premiershipPoints += 4;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.premiershipPoints += 2;
      away.premiershipPoints += 2;
    }
  }

  const out = [...rows.values()];
  for (const row of out) {
    row.percentage = row.pointsAgainst === 0 ? (row.pointsFor > 0 ? row.pointsFor * 100 : 0) : (row.pointsFor / row.pointsAgainst) * 100;
  }
  out.sort((a, b) => b.premiershipPoints - a.premiershipPoints || b.percentage - a.percentage);
  return out;
}

export function top8(ladder: LadderRow[]): LadderRow[] {
  return ladder.slice(0, 8);
}
