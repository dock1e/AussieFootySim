import { useState } from "react";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";
import type { MatchTeam } from "../engine/team";
import {
  tacticGroupFor,
  tacticsFor,
  defaultTacticFor,
  GAME_STYLES,
  type TacticGroup,
  type Tactic,
  type GameStyle,
  type PlayerTactic,
  type TeamPlan,
} from "../engine/tactics";

/**
 * Match Preparation — Engine.md "Match-day flow" step 1 and "Tactics
 * system"/"Game styles": per-player tactics (grouped by position, each
 * group's own menu from Configuration.md), tagger assignment, and a
 * team-wide game style, locked in before kick-off.
 *
 * Every player defaults to their tactic group's Engine.md-confirmed default
 * (e.g. defenders start on "Defensive Shoulder") — a coach who touches
 * nothing here still gets a fully-formed plan, not a no-op one, matching
 * how `sanitizePlan`/`tacticFor` resolve an unlisted player in match.ts.
 */
const GROUP_ORDER: TacticGroup[] = ["Midfield", "KeyForward", "SmallForward", "Ruck", "Defender"];
const GROUP_LABEL: Record<TacticGroup, string> = {
  Midfield: "Midfield",
  KeyForward: "Key forward",
  SmallForward: "Small/medium forward",
  Ruck: "Ruck",
  Defender: "Defender",
};

export interface MatchPreparationProps {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  onBack: () => void;
  onKickOff: (homePlan: TeamPlan, awayPlan: TeamPlan) => void;
}

export function MatchPreparation({ homeTeam, awayTeam, onBack, onKickOff }: MatchPreparationProps) {
  const [homeStyle, setHomeStyle] = useState<GameStyle>("Balanced");
  const [awayStyle, setAwayStyle] = useState<GameStyle>("Balanced");
  const [homeTactics, setHomeTactics] = useState<Map<number, PlayerTactic>>(new Map());
  const [awayTactics, setAwayTactics] = useState<Map<number, PlayerTactic>>(new Map());

  function updateTactic(
    side: "home" | "away",
    playerId: number,
    pt: PlayerTactic,
  ) {
    const set = side === "home" ? setHomeTactics : setAwayTactics;
    set((prev) => {
      const next = new Map(prev);
      next.set(playerId, pt);
      return next;
    });
  }

  function kickOff() {
    onKickOff({ gameStyle: homeStyle, tactics: homeTactics }, { gameStyle: awayStyle, tactics: awayTactics });
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <div className="font-display text-xl italic">Match Preparation</div>
          <div className="text-xs text-slate-400">
            {homeTeam.name} <span className="text-slate-600">vs</span> {awayTeam.name} &middot; set tactics, a
            tagger, and a game style, or just kick off with the defaults.
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onBack} className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700">
            Back
          </button>
          <button onClick={kickOff} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-dark">
            Kick Off
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamPrep
          team={homeTeam}
          opponent={awayTeam}
          style={homeStyle}
          setStyle={setHomeStyle}
          tactics={homeTactics}
          onUpdateTactic={(playerId, pt) => updateTactic("home", playerId, pt)}
        />
        <TeamPrep
          team={awayTeam}
          opponent={homeTeam}
          style={awayStyle}
          setStyle={setAwayStyle}
          tactics={awayTactics}
          onUpdateTactic={(playerId, pt) => updateTactic("away", playerId, pt)}
        />
      </div>
    </div>
  );
}

/**
 * Exported so SelectionCommittee.tsx can reuse the exact same grouped
 * tactic/game-style editor for a club's "Standing Game Plan" (see
 * useTeamPlanStore.ts) — `opponent: null` there, since a standing plan
 * applies across whichever club the fixture throws up next, not one fixed
 * opponent. Tagging's target picker needs a real opponent roster to choose
 * from, so it degrades to an inert note instead of a dead dropdown in that
 * case (see the `opponent === null` branch below).
 */
export function TeamPrep({
  team,
  opponent,
  style,
  setStyle,
  tactics,
  onUpdateTactic,
}: {
  team: MatchTeam;
  opponent: MatchTeam | null;
  style: GameStyle;
  setStyle: (s: GameStyle) => void;
  tactics: Map<number, PlayerTactic>;
  onUpdateTactic: (playerId: number, pt: PlayerTactic) => void;
}) {
  const byGroup = new Map<TacticGroup, Player[]>();
  for (const p of team.players) {
    const group = tacticGroupFor(p.archetype as Archetype);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(p);
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">{team.name}</div>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as GameStyle)}
          className="rounded-lg border border-base-600 bg-base-900 px-2.5 py-1.5 text-xs"
        >
          {GAME_STYLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => (
          <div key={group}>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">{GROUP_LABEL[group]}</div>
            <div className="space-y-1">
              {byGroup.get(group)!.map((p) => {
                const current = tactics.get(p.PlayerID)?.tactic ?? defaultTacticFor(group);
                const taggingTargetId = tactics.get(p.PlayerID)?.taggingTargetId;
                return (
                  <div key={p.PlayerID} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="w-28 shrink-0 truncate text-slate-300">
                      {p.fname[0]}. {p.lname}
                    </span>
                    <select
                      value={current}
                      onChange={(e) => {
                        const tactic = e.target.value as Tactic;
                        onUpdateTactic(p.PlayerID, { tactic, taggingTargetId: tactic === "Tagging" ? taggingTargetId : undefined });
                      }}
                      className="rounded-md border border-base-600 bg-base-900 px-1.5 py-1 text-xs"
                    >
                      {tacticsFor(group).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {current === "Tagging" &&
                      (opponent ? (
                        <select
                          value={taggingTargetId ?? ""}
                          onChange={(e) =>
                            onUpdateTactic(p.PlayerID, { tactic: "Tagging", taggingTargetId: Number(e.target.value) || undefined })
                          }
                          className="rounded-md border border-amber-500/40 bg-base-900 px-1.5 py-1 text-xs text-amber-300"
                        >
                          <option value="">Pick a target&hellip;</option>
                          {opponent.players.map((op) => (
                            <option key={op.PlayerID} value={op.PlayerID}>
                              {op.fname[0]}. {op.lname}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="italic text-slate-500">target set weekly in Match Preparation</span>
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
