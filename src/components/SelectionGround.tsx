import type { Player } from "../types/player";
import type { Archetype, Position, Suitability } from "../types/archetype";
import { suitabilityFor, POSITIONS } from "../types/archetype";
import type { Lineup } from "../engine/selection";

/**
 * The visual ground diagram for the Selection Committee — Phase 7 Slice B
 * (ROADMAP.md), fulfilling the ground-diagram editor `selection.ts`'s own
 * doc comment always named as the real target (this project's "function
 * now, polish later" trade-off finally being paid off, not a new idea).
 * Purely a UI/interaction layer over the same `Lineup`/`POSITIONS` data
 * `SelectionCommittee.tsx`'s old flat dropdown list already used —
 * `match.ts` still only ever consumes *who's* in the 22, never which slot,
 * so nothing here touches the engine.
 *
 * Laid out as the standard AFL team-sheet grid (6 lines of 3, attack at the
 * top per the usual broadcast/team-sheet convention), rather than AFC23's
 * own horizontal band layout (ROADMAP.md item #8's Aug 2026 video-review
 * update) — a deliberate choice: it's the more universally-recognisable
 * shape for a *static* selection screen, and it doesn't need to match
 * MatchCanvas.tsx's horizontal live-match ground, which has its own good
 * reason for its orientation (it mirrors `ground.ts`'s 1-D zone model
 * directly). The two screens serve different purposes and don't need to
 * share one.
 */
const GROUND_ROWS: { label: string; slots: readonly number[] }[] = [
  { label: "Forward", slots: [16, 15, 17] }, // FP, FF, FP
  { label: "Half-Forward", slots: [12, 14, 13] }, // HFF, CHF, HFF
  { label: "Followers", slots: [11, 9, 10] }, // ROV, R, RR
  { label: "Centre", slots: [6, 7, 8] }, // W, C, W
  { label: "Half-Back", slots: [3, 5, 4] }, // HBF, CHB, HBF
  { label: "Back", slots: [1, 0, 2] }, // BP, FB, BP
];
const INTERCHANGE_SLOTS = [18, 19, 20, 21] as const;

const SUITABILITY_BORDER: Record<Suitability, string> = {
  "Very suitable": "border-good",
  "Somewhat suitable": "border-warn",
  "Barely suitable": "border-warn/40",
  "Not suitable": "border-bad",
};

export interface SelectionGroundProps {
  lineup: Lineup;
  playerById: Map<number, Player>;
  /** The player currently selected in the player list, if any — empty slots preview how well they'd suit that slot, per Configuration.md's suitability map. */
  previewPlayer: Player | null;
  onSlotClick: (slotIndex: number) => void;
}

export function SelectionGround({ lineup, playerById, previewPlayer, onSlotClick }: SelectionGroundProps) {
  function occupantAt(slotIndex: number): Player | undefined {
    const id = lineup[slotIndex];
    return id !== null ? playerById.get(id) : undefined;
  }

  return (
    <div className="card space-y-3 border-black/30 bg-[#0f2a1a]">
      <div className="grid grid-cols-3 gap-2">
        {GROUND_ROWS.flatMap((row) =>
          row.slots.map((slotIndex) => (
            <Slot
              key={slotIndex}
              position={POSITIONS[slotIndex]}
              occupant={occupantAt(slotIndex)}
              previewPlayer={previewPlayer}
              onClick={() => onSlotClick(slotIndex)}
            />
          )),
        )}
      </div>
      <div className="border-t border-white/10 pt-3">
        <div className="mb-1.5 text-center text-[10px] uppercase tracking-wide text-slate-400">Interchange</div>
        <div className="grid grid-cols-4 gap-2">
          {INTERCHANGE_SLOTS.map((slotIndex) => (
            <Slot
              key={slotIndex}
              position={POSITIONS[slotIndex]}
              occupant={occupantAt(slotIndex)}
              previewPlayer={previewPlayer}
              onClick={() => onSlotClick(slotIndex)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Slot({
  position,
  occupant,
  previewPlayer,
  onClick,
}: {
  position: Position;
  occupant: Player | undefined;
  previewPlayer: Player | null;
  onClick: () => void;
}) {
  const ownSuitability = occupant ? suitabilityFor(occupant.archetype as Archetype, position) : null;
  const previewSuitability = !occupant && previewPlayer ? suitabilityFor(previewPlayer.archetype as Archetype, position) : null;
  const suitability = ownSuitability ?? previewSuitability;

  const borderClass = suitability ? SUITABILITY_BORDER[suitability] : "border-dashed border-white/20";
  const bgClass = occupant ? "bg-base-800/90 hover:bg-base-700" : "bg-black/20 hover:bg-black/10";

  const title = occupant
    ? `${position} — ${occupant.fname} ${occupant.lname} (${ownSuitability}) — click to send back to the list`
    : previewSuitability
      ? `${position} — ${previewPlayer!.fname} ${previewPlayer!.lname} would be ${previewSuitability} here`
      : `${position} — empty`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-16 flex-col items-center justify-center rounded-lg border-2 px-1 text-center transition-colors ${borderClass} ${bgClass}`}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{position}</span>
      {occupant ? (
        <>
          <span className="max-w-full truncate text-[11px] font-semibold leading-tight text-slate-100">
            #{occupant.jumperNumber} {occupant.lname}
          </span>
          <span className="text-[9px] tabular-nums text-slate-400">{occupant.OVR} OVR</span>
        </>
      ) : (
        <span className="text-lg leading-none text-slate-600">+</span>
      )}
    </button>
  );
}
