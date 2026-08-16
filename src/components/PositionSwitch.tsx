import { useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { ALL_PLAYERS, getPlayersByClub } from "../data/loadPlayers";
import { findSwitchCandidates, type SwitchCandidate } from "../engine/positionSwitch";
import { playerFullName, type Player, type RatedAttribute } from "../types/player";
import { PlayerDetailModal } from "./PlayerDetailModal";

/**
 * Position Switch Review — Engine.md "Position switch / redeployment" +
 * User Interface.md "Position Switch Review (modal)". Not one of the 8
 * Off-Season Hub steps (see engine/positionSwitch.ts's own doc comment and
 * useSaveStore.ts's) — shipped as its own always-available tab instead,
 * matching every other off-season system's precedent (List Needs, Contracts,
 * Trade, Combine, Draft all made the same call rather than building a hub
 * shell). Scoped to `myClub`'s own list only: Engine.md frames this as
 * something "the coach" reviews and decides, and nothing in the vault
 * describes AI-controlled rival clubs getting their own switches — a
 * disclosed asymmetry, the same shape as ROADMAP.md's existing "AI clubs
 * never get a custom lineup" gap.
 *
 * No persisted queue/window state (see engine/positionSwitch.ts's own doc
 * comment) — candidates are recomputed fresh from the live pool on every
 * visit, the same "no dismiss-tracking" precedent ListNeeds.tsx's own doc
 * comment already established. "Keep as {archetype}" therefore only hides a
 * card for the rest of this browser session (plain local component state);
 * nothing is written anywhere, so the same player can resurface on a later
 * visit if they still clear the margin.
 */

/** Disclosed duplicate of engine/positionSwitch.ts's own private label map — components/ can't import from a module-private const, and engine/ stays framework-free, same reasoning Draft.tsx/PlayerDetailModal.tsx already give for their own copies. */
const ATTR_LABEL: Record<RatedAttribute, string> = {
  manMarking: "Man Marking",
  verticalLeap: "Vertical Leap",
  tenacity: "Tenacity",
  skill: "Skill",
  agility: "Agility",
  courage: "Courage",
  aggression: "Aggression",
  xFactor: "X-Factor",
  strengthGroundLevel: "Ground-Level Strength",
  strengthOverhead: "Overhead Strength",
  strengthManOnMan: "Man-on-Man Strength",
  acceleration: "Acceleration",
  speed: "Speed",
  endurance: "Endurance",
  confidence: "Confidence",
  readPlay: "Read of Play",
  consistancy: "Consistency",
  positioning: "Positioning",
  copeWithPressure: "Coping Under Pressure",
  kickMaxDistance: "Kicking Distance",
};

export function PositionSwitch() {
  const myClub = useGameStore((s) => s.myClub);
  const currentYear = useSaveStore((s) => s.year);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const applyPositionSwitch = useSaveStore((s) => s.applyPositionSwitch);

  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Player | null>(null);

  // Re-scans on every pool change (a switch just applied, an off-season step,
  // a load) — see this file's own doc comment on why there's no persisted
  // window/queue to read instead.
  const candidates = useMemo(() => findSwitchCandidates(getPlayersByClub(myClub), ALL_PLAYERS), [myClub, poolVersion]);
  const visible = candidates.filter((c) => !dismissedIds.has(c.player.PlayerID));
  const selectedCount = visible.filter((c) => checkedIds.has(c.player.PlayerID)).length;

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function keep(id: number) {
    setDismissedIds((prev) => new Set(prev).add(id));
    setCheckedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function applySelected() {
    for (const c of visible) {
      if (checkedIds.has(c.player.PlayerID)) applyPositionSwitch(c.player.PlayerID, c.proposedArchetype);
    }
    setCheckedIds(new Set());
  }

  if (visible.length === 0) {
    return (
      <div className="card text-center">
        <div className="mb-2 font-display text-xl italic">No position switches to review right now.</div>
        <p className="mx-auto max-w-md text-sm text-slate-400">
          Every {myClub} player still profiles best in their current archetype. A real off-season progression step
          (attribute gains and declines) is usually what shifts a player's fit enough to surface a switch worth
          considering — check back after one runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Position Switch Review</div>
          <div className="font-display text-xl italic">
            {visible.length} {myClub} player{visible.length === 1 ? "" : "s"} worth a look
          </div>
        </div>
        <button
          onClick={applySelected}
          disabled={selectedCount === 0}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
            selectedCount === 0 ? "cursor-not-allowed bg-base-700 text-slate-500" : "bg-primary hover:bg-primary-dark"
          }`}
        >
          Apply Selected ({selectedCount})
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((c) => (
          <SwitchCard
            key={c.player.PlayerID}
            candidate={c}
            checked={checkedIds.has(c.player.PlayerID)}
            onToggle={() => toggleChecked(c.player.PlayerID)}
            onKeep={() => keep(c.player.PlayerID)}
            onOpenProfile={() => setSelected(c.player)}
          />
        ))}
      </div>

      <div className="px-1 text-xs text-slate-500">
        Flagged when a player's attribute profile fits another same-frame archetype (Tall archetypes only propose
        other Tall archetypes, Mid the same) meaningfully better than their current one — see
        engine/positionSwitch.ts. OVR is recomputed for the proposed archetype; Potential is left untouched.
      </div>

      <PlayerDetailModal player={selected} currentYear={currentYear} onClose={() => setSelected(null)} />
    </div>
  );
}

function SwitchCard({
  candidate,
  checked,
  onToggle,
  onKeep,
  onOpenProfile,
}: {
  candidate: SwitchCandidate;
  checked: boolean;
  onToggle: () => void;
  onKeep: () => void;
  onOpenProfile: () => void;
}) {
  const { player, currentArchetype, proposedArchetype, currentOvr, previewOvr, ovrDelta, justification } = candidate;
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpenProfile} className="text-left font-display text-lg italic hover:text-accent">
          {playerFullName(player)}
        </button>
        <span className="text-xs text-slate-500">Age {player.Age}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-base-800 p-2.5">
          <div className="text-xs uppercase tracking-wide text-slate-500">Current</div>
          <div className="font-semibold">{currentArchetype}</div>
          <div className="text-slate-400">{currentOvr} OVR</div>
        </div>
        <div className="rounded-lg bg-base-800 p-2.5">
          <div className="text-xs uppercase tracking-wide text-accent">Proposed</div>
          <div className="font-semibold">{proposedArchetype}</div>
          <div className="text-slate-400">
            {previewOvr} OVR{" "}
            <span className={ovrDelta > 0 ? "text-good" : ovrDelta < 0 ? "text-bad" : "text-slate-500"}>
              ({ovrDelta > 0 ? "+" : ""}
              {ovrDelta})
            </span>
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-400">Driven by: {justification.map((a) => ATTR_LABEL[a]).join(", ")}</div>

      <div className="flex items-center gap-2 pt-1">
        <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg bg-base-800 px-3 py-2 text-sm hover:bg-base-700">
          <input type="checkbox" checked={checked} onChange={onToggle} />
          Switch to {proposedArchetype}
        </label>
        <button onClick={onKeep} className="rounded-lg bg-base-800 px-3 py-2 text-sm text-slate-300 hover:bg-base-700">
          Keep as {currentArchetype}
        </button>
      </div>
    </div>
  );
}
