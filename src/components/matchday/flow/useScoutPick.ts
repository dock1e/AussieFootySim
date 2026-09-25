import { useEffect, useState } from "react";
import { cloneMatchTeam, type MatchTeam } from "../../../engine/team";
import type { GameStyle, TeamPlan } from "../../../engine/tactics";
import type { AFLStadium } from "../../../data/stadiums";
import { simulateMatch } from "../../../engine/match";
import { mulberry32 } from "../../../engine/rng";
import { STYLE_ORDER } from "./flowData";

/**
 * Match Day flow v2 — "★ Scout suggests {style}". The engine has no table of which style beats which,
 * so the scout plays it out: every style is simulated against this week's opponent with your current
 * team and plan, on the same fixed seeds (so the comparison is like for like), and the style with the
 * best average margin is the pick. 5 styles × 3 matches ≈ 3s, spaced out on timers after a short
 * debounce so the screen stays responsive.
 */

export interface ScoutPickInput {
  mine: MatchTeam;
  opp: MatchTeam;
  mineIsHome: boolean;
  minePlan: TeamPlan;
  oppPlan: TeamPlan;
  stadium: AFLStadium;
  condition?: Map<number, number>;
}

export interface ScoutPick {
  style: GameStyle;
  /** Average margin (your points minus theirs) per style over the scout's matches. */
  margins: Record<GameStyle, number>;
  games: number;
}

const SEEDS = [7101, 7102, 7103];

function marginFor(input: ScoutPickInput, style: GameStyle, seed: number): number {
  const mine = cloneMatchTeam(input.mine);
  const opp = cloneMatchTeam(input.opp);
  const plan: TeamPlan = { ...input.minePlan, gameStyle: style };
  const r = simulateMatch(input.mineIsHome ? mine : opp, input.mineIsHome ? opp : mine, mulberry32(seed), seed, {
    homePlan: input.mineIsHome ? plan : input.oppPlan,
    awayPlan: input.mineIsHome ? input.oppPlan : plan,
    homeCondition: input.condition,
    awayCondition: input.condition,
    stadium: input.stadium,
    recordEvents: false,
  });
  return input.mineIsHome ? r.home.points - r.away.points : r.away.points - r.home.points;
}

export function useScoutPick(input: ScoutPickInput | null, key: string): { pick: ScoutPick | null; pending: boolean } {
  const [state, setState] = useState<{ key: string; pick: ScoutPick | null }>({ key: "", pick: null });

  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    const timers: number[] = [];
    const jobs = STYLE_ORDER.flatMap((style) => SEEDS.map((seed) => ({ style, seed })));
    const totals = Object.fromEntries(STYLE_ORDER.map((s) => [s, 0])) as Record<GameStyle, number>;
    const run = (i: number) => {
      timers.push(
        window.setTimeout(
          () => {
            if (cancelled) return;
            const job = jobs[i];
            totals[job.style] += marginFor(input, job.style, job.seed);
            if (i + 1 < jobs.length) return run(i + 1);
            const margins = Object.fromEntries(STYLE_ORDER.map((s) => [s, totals[s] / SEEDS.length])) as Record<GameStyle, number>;
            const style = [...STYLE_ORDER].sort((a, b) => margins[b] - margins[a])[0];
            setState({ key, pick: { style, margins, games: SEEDS.length } });
          },
          i === 0 ? 400 : 20,
        ),
      );
    };
    run(0);
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
    // `key` summarises everything in `input` that changes the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { pick: state.key === key ? state.pick : null, pending: state.key !== key };
}
