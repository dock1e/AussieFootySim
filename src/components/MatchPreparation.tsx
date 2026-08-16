import { useMemo, useState } from "react";
import type { Player } from "../types/player";
import type { Archetype, Position } from "../types/archetype";
import { suitabilityFor } from "../types/archetype";
import type { MatchTeam } from "../engine/team";
import { benchPlayers } from "../engine/team";
import { useGameStore } from "../store/useGameStore";
import { useTeamPlanStore } from "../store/useTeamPlanStore";
import {
  tacticGroupFor,
  tacticGroupForSlot,
  tacticsFor,
  defaultTacticForPosition,
  GAME_STYLES,
  type TacticGroup,
  type Tactic,
  type GameStyle,
  type PlayerTactic,
  type TeamPlan,
} from "../engine/tactics";
import { GROUND_ROW_POSITIONS } from "./SelectionGround";

/**
 * Match Preparation — Engine.md "Match-day flow" step 1 and "Tactics
 * system"/"Game styles": per-player tactics (grouped by position, each
 * group's own menu from Configuration.md), tagger assignment, and a
 * team-wide game style, locked in before kick-off.
 *
 * Round 16 (Aug 2026), Tyler: "I would ideally like it to be similar to the
 * selection screen where we see the players on the field matched up against
 * their opponents and can use drop boxes to individually configure our
 * tactics" — this screen used to be a flat dropdown list (see git history),
 * genuinely disconnected from the ground-diagram language `SelectionGround`
 * already established. `TeamPrep` below now renders that same real-position
 * grid (`GROUND_ROW_POSITIONS`, imported so both files share one row layout)
 * with each slot's tactic dropdown built into the cell itself, whenever the
 * team it's given actually has real per-slot position data — see
 * `PositionGroundEditor`'s own doc comment for what happens when it doesn't
 * (an AI opponent auto-filled by `pickBest22`, which never populates
 * `MatchTeam.positions`).
 *
 * Tyler also asked, in the same message: "Do we even need two screens for
 * this (Selection and Match)?" Kept as two, deliberately — they hold
 * genuinely different data, not just different views of the same thing.
 * Selection Committee edits the coach's own club's persistent 23-player
 * squad with no fixed opponent (`opponent: null` below, always); Match
 * Preparation is handed two already-built `MatchTeam`s for one specific,
 * already-decided fixture, with a real opponent roster to tag from. Merging
 * them would mean Selection Committee somehow acquiring an opponent concept
 * it doesn't otherwise need (it's used season-round-to-round, not only
 * right before a kick-off), for a resemblance that's now handled the right
 * way already — a shared *look*, via the same `GROUND_ROW_POSITIONS`/
 * suitability-border language, without forcing one shared *screen*.
 *
 * Every player defaults to their own position's tactic (Aug 2026, e.g. a
 * Back Pocket starts on "General Defender" while a Full Back starts on
 * "Defensive Shoulder" — see [[Tactics and Positional Play]] Part 7) when
 * this team carries real Selection Committee position data, falling back to
 * the plain tactic-group default otherwise — a coach who touches nothing
 * here still gets a fully-formed plan, not a no-op one, matching how
 * `sanitizePlan`/`tacticFor` resolve an unlisted player in match.ts.
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
  const myClub = useGameStore((s) => s.myClub);

  /**
   * Standing Game Plan seed — Aug 2026, round 17, Tyler: "When I select my
   * standing game plan, it should copy as the default game plan which
   * applies in the Match tab. After setting my standard game plan I
   * navigated to the Match tab and needed to reselect all the roles again."
   * Whichever side is the coach's own club starts from their Standing Game
   * Plan (useTeamPlanStore.ts, edited on the Selection tab) instead of
   * always-blank defaults; the other side (an AI opponent, or neither side if
   * this is a spectated AI-vs-AI friendly) is unaffected. Read once via
   * `getState()` inside a lazy `useState` initialiser rather than a
   * subscribed hook — this screen is freshly mounted every time LiveMatch
   * enters "prep" stage and thrown away on Back/Kick Off, so it only ever
   * needs a one-time editable *copy* of the standing plan, the same
   * "snapshot, not a live binding" relationship Selection Committee's own
   * lineup editor already has with the underlying store.
   */
  const [homeStyle, setHomeStyle] = useState<GameStyle>(() =>
    homeTeam.name === myClub ? (useTeamPlanStore.getState().planFor(myClub)?.gameStyle ?? "Balanced") : "Balanced",
  );
  const [awayStyle, setAwayStyle] = useState<GameStyle>(() =>
    awayTeam.name === myClub ? (useTeamPlanStore.getState().planFor(myClub)?.gameStyle ?? "Balanced") : "Balanced",
  );
  const [homeTactics, setHomeTactics] = useState<Map<number, PlayerTactic>>(
    () => new Map(homeTeam.name === myClub ? useTeamPlanStore.getState().planFor(myClub)?.tactics : undefined),
  );
  const [awayTactics, setAwayTactics] = useState<Map<number, PlayerTactic>>(
    () => new Map(awayTeam.name === myClub ? useTeamPlanStore.getState().planFor(myClub)?.tactics : undefined),
  );

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
          <button onClick={kickOff} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark">
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
  const hasRealPositions = !!team.positions && team.positions.size > 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
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

      {hasRealPositions ? (
        <PositionGroundEditor team={team} opponent={opponent} tactics={tactics} onUpdateTactic={onUpdateTactic} />
      ) : (
        <FlatTacticList team={team} opponent={opponent} tactics={tactics} onUpdateTactic={onUpdateTactic} />
      )}
    </div>
  );
}

/**
 * Groups `team.players` by their real assigned `Position`, preserving squad
 * order — for the 5 positions with two real slots (BP, HBF, W, HFF, FP),
 * this means the first occupant encountered in `team.players` order lands in
 * the row's first cell for that label and the second in its second, a
 * rendering-only convention (no gameplay difference either way — see
 * `engine/ground.ts`'s own identical note on `assignLanes`, the same
 * underlying ambiguity: the engine records *which* position a player fills,
 * never which literal copy of a duplicated slot).
 */
function groupByPosition(team: MatchTeam): Map<Position, Player[]> {
  const map = new Map<Position, Player[]>();
  if (!team.positions) return map;
  for (const p of team.players) {
    const pos = team.positions.get(p.PlayerID);
    if (!pos || pos === "INT") continue; // interchange is handled separately, via benchPlayers below
    if (!map.has(pos)) map.set(pos, []);
    map.get(pos)!.push(p);
  }
  return map;
}

/**
 * The ground-diagram tactics editor — same 6-row broadcast team-sheet
 * layout as `SelectionGround` (`GROUND_ROW_POSITIONS`), each cell showing
 * that position's real occupant with their tactic (and, for the current
 * tagger, a target) editable right there, plus an interchange strip below
 * mirroring `MatchCanvas.tsx`'s own bench chips.
 *
 * Only usable when `team.positions` has real per-slot data — an AI club
 * auto-filled via `pickBest22` (any opponent whose coach hasn't got a
 * completed Selection Committee lineup) has no such data at all, since
 * `pickBest22` only ever picks *who's* in the squad, never which of the 18
 * real slots each player fills. `TeamPrep` above checks for this and falls
 * back to `FlatTacticList` in that case — deliberately not inventing fake
 * precise slot assignments for a team that never had them.
 */
function PositionGroundEditor({
  team,
  opponent,
  tactics,
  onUpdateTactic,
}: {
  team: MatchTeam;
  opponent: MatchTeam | null;
  tactics: Map<number, PlayerTactic>;
  onUpdateTactic: (playerId: number, pt: PlayerTactic) => void;
}) {
  const byPosition = useMemo(() => groupByPosition(team), [team]);
  const bench = useMemo(() => benchPlayers(team), [team]);

  // How many of a given position's cells this render pass has already
  // handed out a player to — lets the two-slot positions (BP/HBF/W/HFF/FP)
  // split their (up to) two real occupants across both of that row's
  // matching cells instead of both landing in the first one. Reset fresh
  // every render (not state) since it's only ever used synchronously while
  // building this one pass of cells below.
  const seen = new Map<Position, number>();
  function nextOccupant(pos: Position): Player | undefined {
    const list = byPosition.get(pos) ?? [];
    const i = seen.get(pos) ?? 0;
    seen.set(pos, i + 1);
    return list[i];
  }

  return (
    <div className="space-y-3 rounded-lg border border-black/30 bg-[#0f2a1a] p-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        {GROUND_ROW_POSITIONS.flatMap((row) =>
          row.positions.map((pos, i) => (
            <PositionCell
              key={`${row.label}-${i}`}
              position={pos}
              player={nextOccupant(pos)}
              opponent={opponent}
              tactics={tactics}
              onUpdateTactic={onUpdateTactic}
            />
          )),
        )}
      </div>

      {bench.length > 0 && (
        <div className="border-t border-white/10 pt-2">
          <div className="mb-1.5 text-center text-[10px] uppercase tracking-wide text-slate-400">Interchange</div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {bench.map((p) => (
              <span
                key={p.PlayerID}
                className="inline-flex items-center gap-1.5 rounded-full bg-base-800/90 py-1 pl-1 pr-2.5 text-[11px] text-slate-300"
                title={`${p.fname} ${p.lname} — on the interchange (no rotation strategy is modelled yet, so this is informational only)`}
              >
                <span className="rounded-full bg-base-700 px-1.5 py-0.5 text-[9px] tabular-nums text-slate-400">#{p.jumperNumber}</span>
                {p.lname}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SUITABILITY_BORDER: Record<string, string> = {
  "Very suitable": "border-good",
  "Somewhat suitable": "border-warn",
  "Barely suitable": "border-warn/40",
  "Not suitable": "border-bad",
};

function PositionCell({
  position,
  player,
  opponent,
  tactics,
  onUpdateTactic,
}: {
  position: Position;
  player: Player | undefined;
  opponent: MatchTeam | null;
  tactics: Map<number, PlayerTactic>;
  onUpdateTactic: (playerId: number, pt: PlayerTactic) => void;
}) {
  if (!player) {
    return (
      <div className="flex h-[74px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-white/20 bg-black/20 px-1 text-center">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{position}</span>
        <span className="text-lg leading-none text-slate-600">?</span>
      </div>
    );
  }

  // Round 17, Tyler: "when I select Max Gawn at Full Forward the role
  // options that present to me are based on Max Gawn as a Ruck... he should
  // be asked to play the role of a full forward" — this cell always renders
  // a real, known on-ground position (never INT), so `tacticGroupForSlot`
  // always resolves via that position, not the player's raw archetype.
  const group = tacticGroupForSlot(position, player.archetype as Archetype);
  const current = tactics.get(player.PlayerID)?.tactic ?? defaultTacticForPosition(position, group);
  const taggingTargetId = tactics.get(player.PlayerID)?.taggingTargetId;
  const suitability = suitabilityFor(player.archetype as Archetype, position);
  const borderClass = SUITABILITY_BORDER[suitability] ?? "border-base-600";

  return (
    <div className={`flex flex-col gap-1 rounded-lg border-2 bg-base-800/90 p-1.5 ${borderClass}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{position}</span>
        <span className="truncate text-[11px] font-semibold leading-tight text-slate-100" title={`${player.fname} ${player.lname}`}>
          #{player.jumperNumber} {player.lname}
        </span>
      </div>
      <select
        value={current}
        onChange={(e) => {
          const tactic = e.target.value as Tactic;
          onUpdateTactic(player.PlayerID, { tactic, taggingTargetId: tactic === "Tagging" ? taggingTargetId : undefined });
        }}
        className="w-full rounded-md border border-base-600 bg-base-900 px-1 py-1 text-[10px]"
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
            onChange={(e) => onUpdateTactic(player.PlayerID, { tactic: "Tagging", taggingTargetId: Number(e.target.value) || undefined })}
            className="w-full rounded-md border border-amber-500/40 bg-base-900 px-1 py-1 text-[10px] text-amber-300"
          >
            <option value="">Pick a target&hellip;</option>
            {opponent.players.map((op) => (
              <option key={op.PlayerID} value={op.PlayerID}>
                {op.fname[0]}. {op.lname}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-center text-[9px] italic text-slate-500">target set weekly in Match Prep</span>
        ))}
    </div>
  );
}

/**
 * The original flat, grouped-by-tactic-role list — kept as the fallback for
 * any team without real per-slot position data (see `TeamPrep`'s own
 * branch above), since `PositionGroundEditor` has nothing to lay out a real
 * grid from in that case.
 */
function FlatTacticList({
  team,
  opponent,
  tactics,
  onUpdateTactic,
}: {
  team: MatchTeam;
  opponent: MatchTeam | null;
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
    <div className="space-y-3">
      <div className="text-[11px] italic text-slate-500">No completed Selection Committee lineup for {team.name} yet, so positions aren't known — grouped by role instead.</div>
      {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => (
        <div key={group}>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">{GROUP_LABEL[group]}</div>
          <div className="space-y-1">
            {byGroup.get(group)!.map((p) => {
              const current = tactics.get(p.PlayerID)?.tactic ?? defaultTacticForPosition(team.positions?.get(p.PlayerID), group);
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
  );
}
