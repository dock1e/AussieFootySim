import { useEffect, useMemo, useState } from "react";
import type { Player } from "../types/player";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { useTeamPlanStore } from "../store/useTeamPlanStore";
import { useSaveStore } from "../store/useSaveStore";
import { getPlayersByClub } from "../data/loadPlayers";
import { emptyLineup, isLineupComplete, lineupPlayerIds, lineupToMatchTeam } from "../engine/selection";
import { benchPlayers, pickBest22 } from "../engine/team";
import { POSITIONS, defaultEligiblePositions, suitabilityFor, type Archetype, type Position } from "../types/archetype";
import { defaultTeamPlan } from "../engine/tactics";
import { TeamPrep } from "./MatchPreparation";
import { SelectionGround, GROUND_ROW_POSITIONS } from "./SelectionGround";
import { SelectionPlayerList } from "./SelectionPlayerList";
import { PlayerLink } from "./PlayerLink";

/**
 * Selection Committee — Configuration.md "Positions" (18 on-field slots + 5
 * interchange, the 2026 AFL rule change — see types/archetype.ts's
 * `POSITIONS`) with `suitabilityFor` guidance (built back in Phase 0).
 *
 * Phase 7 Slice B (ROADMAP.md): the lineup editor is now the real
 * ground-diagram picker `selection.ts`'s own doc comment always named as
 * the target, not the flat dropdown list this screen originally shipped
 * with ("function now, polish later" — the polish has arrived). Click a
 * player in `SelectionPlayerList`, then click a slot in `SelectionGround`
 * to place them (click a filled slot on its own to send that player back to
 * the list) — see those two files for the visual/interaction detail. The
 * underlying data is completely unchanged: still the same `Lineup` array
 * via `useSelectionStore`, still consumed identically by `lineupToMatchTeam`
 * and match.ts, which only ever cares who's in the squad, never which slot
 * (beyond the on-ground/interchange split — see `MatchTeam.onGround`).
 *
 * Only edits the signed-in coach's own club (`useGameStore.myClub`) — see
 * LiveMatch.tsx for where a completed lineup actually feeds a Match-tab
 * game, and useSeasonStore.ts for the Season tab.
 *
 * Also hosts the "Standing Game Plan" — a per-club default tactics/game
 * style (useTeamPlanStore.ts), reusing MatchPreparation.tsx's own TeamPrep
 * editor. This is what lets the Season tab's headless round simulation
 * respect tactics at all, since it has no per-match interactive prep step
 * the way the Match tab does.
 */
export function SelectionCommittee() {
  const myClub = useGameStore((s) => s.myClub);
  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const { lineupFor, setSlot, autoFill, clear, eligibilityFor, setEligibility } = useSelectionStore();
  const lineup = lineupFor(myClub) ?? emptyLineup();
  const eligibilityOverrides = eligibilityFor(myClub);

  // Which player (if any) is "picked up" from the list, awaiting a slot
  // click to place them — see handleSlotClick below. Reset whenever the
  // coach switches clubs, since a selection from the old club's list would
  // otherwise dangle and could get placed into the new club's lineup.
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  useEffect(() => setSelectedPlayerId(null), [myClub]);

  const filledCount = lineupPlayerIds(lineup).length;
  const complete = isLineupComplete(lineup);

  const playerById = useMemo(() => new Map(players.map((p) => [p.PlayerID, p])), [players]);
  const selectedPlayer = selectedPlayerId !== null ? (playerById.get(selectedPlayerId) ?? null) : null;

  function handleSelectPlayer(p: Player) {
    setSelectedPlayerId((cur) => (cur === p.PlayerID ? null : p.PlayerID));
  }

  function handleSlotClick(slotIndex: number) {
    if (selectedPlayerId !== null) {
      setSlot(myClub, slotIndex, selectedPlayerId);
      setSelectedPlayerId(null);
    } else if (lineup[slotIndex] !== null) {
      setSlot(myClub, slotIndex, null);
    }
  }

  // The same squad the Match/Season tabs would actually field for this club
  // right now — the completed lineup once it's full, pickBest22's OVR-only
  // stand-in before that — so the Standing Game Plan below is always editing
  // tactics for whoever's really going to take the park.
  const myTeam = useMemo(
    () => (complete ? lineupToMatchTeam(myClub, lineup, players, eligibilityOverrides) : pickBest22(myClub, players)),
    [myClub, complete, lineup, players, eligibilityOverrides],
  );

  const { planFor, setGameStyle, setTactic } = useTeamPlanStore();
  const plan = planFor(myClub) ?? defaultTeamPlan();

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <div>
          <div className="font-display text-xl italic">{myClub} &mdash; Selection Committee</div>
          <div className="text-xs text-slate-400">
            {filledCount}/{POSITIONS.length} slots filled {complete && <span className="text-accent-light">&middot; ready for kick-off</span>}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              autoFill(myClub, players);
              setSelectedPlayerId(null);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            Auto-fill
          </button>
          <button
            onClick={() => {
              clear(myClub);
              setSelectedPlayerId(null);
            }}
            className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="card text-xs text-slate-400">
        Drag a player onto a position to place them there, or click a player then click a position
        instead — click a filled slot on its own to send that player back to the list. Every club
        player is eligible for every slot; a slot's border colour shows how well the selected (or
        already placed) player suits it, per Configuration.md's suitability map. This lineup is only
        used when {myClub} is picked for a match on the Match or Season tab; anyone else still fields
        the auto-picked best-{POSITIONS.length} by OVR.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <SelectionPlayerList players={players} lineup={lineup} selectedPlayerId={selectedPlayerId} onSelect={handleSelectPlayer} />
        <SelectionGround
          lineup={lineup}
          playerById={playerById}
          previewPlayer={selectedPlayer}
          onSlotClick={handleSlotClick}
          onDropPlayer={(slotIndex, playerId) => {
            setSlot(myClub, slotIndex, playerId);
            setSelectedPlayerId(null);
          }}
        />
      </div>

      {complete && benchPlayers(myTeam).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-400">Interchange Eligibility</div>
          <div className="card text-xs text-slate-400">
            Which real ground positions each interchange player is allowed to rotate into during a
            match — set once here so an automatic swap (or a manual one, mid-match) can never put the
            wrong body type in a slot, like a small defender backfilling Back Pocket for a tall one.
            Leave a player untouched for a sensible default based on their archetype.
          </div>
          <InterchangeEligibilityEditor bench={benchPlayers(myTeam)} overrides={eligibilityOverrides} onToggle={(playerId, positions) => setEligibility(myClub, playerId, positions)} />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">Standing Game Plan</div>
          <SavedIndicator />
        </div>
        <div className="card text-xs text-slate-400">
          Sets {myClub}'s default tactics and game style. The Match tab always lets you set tactics
          fresh in Match Preparation before kick-off, but the Season tab simulates rounds headlessly
          with no per-match prep step — this is what it uses instead. A tagger set here holds the
          slot, but the actual target still has to be picked live in Match Preparation, since a
          standing plan spans whatever opponent the fixture throws up next.
        </div>
        <TeamPrep
          team={myTeam}
          opponent={null}
          style={plan.gameStyle}
          setStyle={(style) => setGameStyle(myClub, style)}
          tactics={plan.tactics}
          onUpdateTactic={(playerId, pt) => setTactic(myClub, playerId, pt)}
        />
      </div>
    </div>
  );
}

/** `GROUND_ROW_POSITIONS`, deduped to the 13 real unique position labels (BP/HBF/W/HFF/FP each appear twice there — once per real slot — but "eligible for BP" means either slot, so this editor only ever needs to show each label once). Computed once at module scope since it's static. */
const UNIQUE_ELIGIBILITY_ROWS: { label: string; positions: Position[] }[] = GROUND_ROW_POSITIONS.map((row) => ({
  label: row.label,
  positions: [...new Set(row.positions)],
}));

const ELIGIBILITY_SUITABILITY_STYLE: Record<string, string> = {
  "Very suitable": "border-good text-good",
  "Somewhat suitable": "border-warn text-warn",
  "Barely suitable": "border-warn/40 text-slate-400",
  "Not suitable": "border-bad text-bad",
};

/**
 * Aug 2026, round 48 — [[Interchange Rotation]]: one per-player editor for
 * `MatchTeam.interchangeEligibility`'s override map — Tyler's own worked
 * examples ("Forward Pocket, Half Forward Flank, Wing... Back Pocket, Half
 * Back Flank, Wing...") are exactly a small hand-picked position set per
 * bench player, so this is a plain toggle grid, not a drag-and-drop editor
 * like `SelectionGround`'s slot placement — there's no ordering or
 * one-slot-per-player constraint here, just "on or off" per real position.
 *
 * Every pill is coloured by `suitabilityFor` regardless of its current
 * on/off state (same border-colour language `SelectionGround`/
 * `MatchPreparation` already use), so a coach can see at a glance both
 * "is this naturally a good fit" and "is it currently enabled" — a filled
 * pill is enabled, an outline pill isn't, and the colour itself never
 * changes based on that state.
 */
function InterchangeEligibilityEditor({
  bench,
  overrides,
  onToggle,
}: {
  bench: Player[];
  overrides: Record<number, Position[]> | undefined;
  onToggle: (playerId: number, positions: Position[]) => void;
}) {
  function effectiveFor(player: Player): Position[] {
    return overrides?.[player.PlayerID] ?? defaultEligiblePositions(player.archetype as Archetype);
  }

  return (
    <div className="space-y-2">
      {bench.map((player) => {
        const effective = effectiveFor(player);
        const hasOverride = overrides?.[player.PlayerID] !== undefined;
        return (
          <div key={player.PlayerID} className="card space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-base-700 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-400">#{player.jumperNumber}</span>
                <span className="text-sm font-semibold text-slate-100">
                  <PlayerLink player={player} />
                </span>
                <span className="text-xs text-slate-500">{player.archetype}</span>
              </div>
              {hasOverride && (
                <button onClick={() => onToggle(player.PlayerID, [])} className="text-[11px] text-slate-500 underline decoration-dotted hover:text-slate-300">
                  Reset to default
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {UNIQUE_ELIGIBILITY_ROWS.flatMap((row) => row.positions).map((position) => {
                const active = effective.includes(position);
                const suitability = suitabilityFor(player.archetype as Archetype, position);
                const colour = ELIGIBILITY_SUITABILITY_STYLE[suitability] ?? "border-base-600 text-slate-400";
                return (
                  <button
                    key={position}
                    onClick={() => {
                      const next = active ? effective.filter((p) => p !== position) : [...effective, position];
                      onToggle(player.PlayerID, next);
                    }}
                    title={`${position} — ${suitability} for a ${player.archetype}`}
                    className={`rounded-full border-2 px-2.5 py-1 text-[11px] font-semibold transition-colors ${colour} ${
                      active ? "bg-base-700" : "bg-transparent opacity-60 hover:opacity-100"
                    }`}
                  >
                    {position}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Reuses App.tsx's SaveMenu "Saved HH:MM:SS" dot right next to the section
 * being edited — Aug 2026, round 17, Tyler: "once I've done all these edits
 * in my standing game plan I want a save button or some kind of visual
 * reference to indicate that these changes will be remembered." There's
 * deliberately no manual Save button anywhere in this app (see SaveMenu's
 * own doc comment) — useTeamPlanStore is already one of the stores
 * useSaveStore.ts auto-saves on every change (its `subscribed` block), so
 * standing-plan edits were already being remembered; the actual gap was that
 * nothing near this section said so. Reuses `useSaveStore`'s existing
 * `lastSavedAt` signal rather than adding a second, competing save concept.
 */
function SavedIndicator() {
  const lastSavedAt = useSaveStore((s) => s.lastSavedAt);
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] tabular-nums text-slate-500"
      title="Saving is automatic — there's no manual Save button, this confirms your standing game plan changes are being remembered"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${lastSavedAt ? "bg-good" : "bg-base-600"}`} />
      {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : "Not saved yet"}
    </span>
  );
}
