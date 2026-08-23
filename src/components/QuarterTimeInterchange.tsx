import { useState } from "react";
import type { Player } from "../types/player";
import type { Position } from "../types/archetype";
import type { MatchTeam } from "../engine/team";
import { benchPlayers } from "../engine/team";
import { seedMorale } from "../engine/morale";
import { GROUND_ROW_POSITIONS } from "./SelectionGround";
import { groupByPosition } from "./MatchPreparation";

/**
 * Aug 2026, round 48 — [[Interchange Rotation]]. Tyler: "When the user
 * clicks 'pause' during the match sim, he should be presented something
 * akin to the match selection screen where he can see the current player
 * statistics, their fitness, their morale and their current positions and
 * roles on the ground so that the coach can opt to manually interchange...
 * as well as the same feature at quarter time." Slice 1 ships the
 * quarter-time half of that ask (see the design note's own staging
 * section for why genuine mid-quarter pause-and-edit is a later slice) —
 * `LiveMatch.tsx` renders one of these per side alongside `CoachsCall`
 * whenever the sim is stopped at a quarter break.
 *
 * Same ground-diagram visual language `SelectionGround`/`MatchPreparation`
 * already established (`GROUND_ROW_POSITIONS`, suitability-style borders),
 * but a simpler two-step interaction than either of those: click a bench
 * player to arm them, then click a highlighted (eligible) on-ground cell to
 * complete the swap — no drag-and-drop, since this is a small, occasional
 * action, not the primary editing surface team selection already is.
 * Ineligible on-ground cells dim rather than disappear, so the coach can see
 * at a glance which of their armed player's real positions are actually
 * occupied right now.
 */
export interface QuarterTimeInterchangeProps {
  team: MatchTeam;
  fitnessFor: (playerId: number) => number;
  onInterchange: (outgoingId: number, incomingId: number) => void;
}

function moraleFor(player: Pick<Player, "PlayerID" | "morale">): number {
  return player.morale ?? seedMorale(player);
}

function MiniBar({ value, colourClass }: { value: number; colourClass: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-base-700">
      <div className={`h-full ${colourClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function fitnessColour(value: number): string {
  return value >= 70 ? "bg-good" : value >= 45 ? "bg-warn" : "bg-bad";
}

export function QuarterTimeInterchange({ team, fitnessFor, onInterchange }: QuarterTimeInterchangeProps) {
  const [armedBenchId, setArmedBenchId] = useState<number | null>(null);

  if (!team.onGround || !team.positions || !team.interchangeEligibility) {
    return (
      <div className="card text-xs italic text-slate-500">
        No real Selection Committee position data for {team.name} — nothing to interchange within.
      </div>
    );
  }

  const byPosition = groupByPosition(team);
  const bench = benchPlayers(team);
  const armedBench = armedBenchId !== null ? bench.find((p) => p.PlayerID === armedBenchId) : undefined;
  const armedEligible = armedBench ? team.interchangeEligibility.get(armedBench.PlayerID) : undefined;

  const seen = new Map<Position, number>();
  function nextOccupant(pos: Position): Player | undefined {
    const list = byPosition.get(pos) ?? [];
    const i = seen.get(pos) ?? 0;
    seen.set(pos, i + 1);
    return list[i];
  }

  return (
    <div className="card space-y-2">
      <div className="text-sm font-semibold">{team.name}</div>
      <div className="rounded-lg border border-black/30 bg-[#0f2a1a] p-2.5">
        <div className="grid grid-cols-3 gap-1.5">
          {GROUND_ROW_POSITIONS.flatMap((row) =>
            row.positions.map((pos, i) => {
              const player = nextOccupant(pos);
              const eligible = !!armedBench && !!armedEligible?.has(pos);
              const clickable = !!armedBench && !!player && eligible;
              return (
                <button
                  key={`${row.label}-${i}`}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (clickable && armedBench && player) {
                      onInterchange(player.PlayerID, armedBench.PlayerID);
                      setArmedBenchId(null);
                    }
                  }}
                  title={player ? `${pos} — ${player.fname} ${player.lname}${armedBench ? (eligible ? " — click to bring " + armedBench.lname + " on here" : ` — ${armedBench.lname} isn't eligible for ${pos}`) : ""}` : pos}
                  className={`flex h-[76px] flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-1 text-center transition-colors ${
                    armedBench ? (eligible ? "cursor-pointer border-accent bg-accent/10" : "cursor-not-allowed border-base-700 opacity-30") : "border-base-600 bg-base-800/90"
                  }`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{pos}</span>
                  {player ? (
                    <>
                      <span className="max-w-full truncate text-[11px] font-semibold leading-tight text-slate-100">
                        #{player.jumperNumber} {player.lname}
                      </span>
                      <span className="w-11">
                        <MiniBar value={fitnessFor(player.PlayerID)} colourClass={fitnessColour(fitnessFor(player.PlayerID))} />
                      </span>
                      <span className="text-[9px] tabular-nums text-slate-500">
                        F{Math.round(fitnessFor(player.PlayerID))} &middot; M{Math.round(moraleFor(player))}
                      </span>
                    </>
                  ) : (
                    <span className="text-lg leading-none text-slate-600">—</span>
                  )}
                </button>
              );
            }),
          )}
        </div>

        {bench.length > 0 && (
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="mb-1.5 text-center text-[10px] uppercase tracking-wide text-slate-400">
              {armedBench ? `${armedBench.lname} armed — click a highlighted position, or click them again to cancel` : "Interchange — click a bench player to arm a swap"}
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {bench.map((p) => {
                const isArmed = armedBenchId === p.PlayerID;
                return (
                  <button
                    key={p.PlayerID}
                    type="button"
                    onClick={() => setArmedBenchId(isArmed ? null : p.PlayerID)}
                    className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-1 text-[11px] transition-colors ${
                      isArmed ? "border-accent bg-accent/10" : "border-base-600 bg-base-800/90 hover:bg-base-700"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="rounded-full bg-base-700 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-400">#{p.jumperNumber}</span>
                      <span className="text-slate-200">{p.lname}</span>
                    </span>
                    <span className="w-14">
                      <MiniBar value={fitnessFor(p.PlayerID)} colourClass={fitnessColour(fitnessFor(p.PlayerID))} />
                    </span>
                    <span className="text-[9px] tabular-nums text-slate-500">
                      F{Math.round(fitnessFor(p.PlayerID))} &middot; M{Math.round(moraleFor(p))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
