import { useEffect, useState } from "react";
import { cloneMatchTeam, type MatchTeam } from "../../../engine/team";
import type { TeamPlan } from "../../../engine/tactics";
import type { AFLStadium } from "../../../data/stadiums";
import { simulateMatch } from "../../../engine/match";
import { mulberry32 } from "../../../engine/rng";
import { computeFantasyMetrics } from "../../../engine/fantasyEngine";

/**
 * Match Day flow, Rotations step: projected time on ground from real headless matches. Each projection
 * plays this week's match with the current line-up, rotations and standing plan (fixed seeds, so the
 * same plan always projects the same numbers) and reads each player's TOG the same way the live board
 * does (`computeFantasyMetrics`). One match takes ~0.2s, so the runs are spaced out on timers after a
 * short debounce rather than blocking an edit.
 */

export interface TogProjectionInput {
  mine: MatchTeam;
  opp: MatchTeam;
  mineIsHome: boolean;
  minePlan: TeamPlan;
  oppPlan: TeamPlan;
  stadium: AFLStadium;
  condition?: Map<number, number>;
}

const SEEDS = [20260925, 20260926];

function projectOnce(input: TogProjectionInput, seed: number): Map<number, number> {
  const mine = cloneMatchTeam(input.mine);
  const opp = cloneMatchTeam(input.opp);
  const home = input.mineIsHome ? mine : opp;
  const away = input.mineIsHome ? opp : mine;
  const r = simulateMatch(home, away, mulberry32(seed), seed, {
    homePlan: input.mineIsHome ? input.minePlan : input.oppPlan,
    awayPlan: input.mineIsHome ? input.oppPlan : input.minePlan,
    homeCondition: input.condition,
    awayCondition: input.condition,
    stadium: input.stadium,
  });
  const ids = input.mine.players.map((p) => p.PlayerID);
  const m = computeFantasyMetrics(
    { events: r.events, ticksPerQuarter: r.ticksPerQuarter, stadium: input.stadium, lines: r.boxScore, fitnessOf: () => 100, seasonAvgFpOf: () => 0 },
    ids,
  );
  return new Map(ids.map((id) => [id, m.get(id)?.tog ?? 0]));
}

export function useTogProjection(input: TogProjectionInput | null, key: string): { tog: Map<number, number> | null; pending: boolean } {
  const [state, setState] = useState<{ key: string; tog: Map<number, number> | null }>({ key: "", tog: null });

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    const runs: Map<number, number>[] = [];
    const timers: number[] = [];
    const step = (i: number) => {
      timers.push(
        window.setTimeout(
          () => {
            if (cancelled) return;
            runs.push(projectOnce(input, SEEDS[i]));
            if (i + 1 < SEEDS.length) step(i + 1);
            else {
              const avg = new Map<number, number>();
              for (const id of runs[0].keys()) avg.set(id, runs.reduce((a, r) => a + (r.get(id) ?? 0), 0) / runs.length);
              setState({ key, tog: avg });
            }
          },
          i === 0 ? 350 : 30,
        ),
      );
    };
    step(0);
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
    // `key` summarises everything in `input` that changes the projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = state.key === key;
  return { tog: state.tog, pending: !fresh };
}
