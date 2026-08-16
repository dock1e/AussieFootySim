import { useMemo, useState } from "react";
import type { Player } from "../types/player";
import { POSITIONS } from "../types/archetype";
import type { Lineup } from "../engine/selection";

/**
 * The player-picking half of the Selection Committee ground diagram — Phase
 * 7 Slice B (ROADMAP.md). Click a row to select a player (highlighted);
 * click it again (or place them) to deselect. Mirrors SquadList.tsx's own
 * sortable-header idiom, kept local to this component rather than sharing
 * its global sort-state store slice — this list's sort preference is
 * naturally page-local, nothing else needs it to persist across tab
 * switches.
 */
type SortKey = "OVR" | "POT" | "Age" | "lname" | "jumperNumber";

const SORT_ACCESSORS: Record<SortKey, (p: Player) => number | string> = {
  OVR: (p) => p.OVR,
  POT: (p) => p.POT,
  Age: (p) => p.Age,
  lname: (p) => p.lname,
  jumperNumber: (p) => p.jumperNumber,
};

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "jumperNumber", label: "#" },
  { key: "lname", label: "Player" },
  { key: null, label: "Pos" },
  { key: "Age", label: "Age" },
  { key: "OVR", label: "OVR" },
  { key: "POT", label: "POT" },
  { key: null, label: "Slot" },
];

export interface SelectionPlayerListProps {
  players: Player[];
  lineup: Lineup;
  selectedPlayerId: number | null;
  onSelect: (player: Player) => void;
}

export function SelectionPlayerList({ players, lineup, selectedPlayerId, onSelect }: SelectionPlayerListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("OVR");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const slotIndexByPlayerId = useMemo(() => {
    const map = new Map<number, number>();
    lineup.forEach((id, i) => {
      if (id !== null) map.set(id, i);
    });
    return map;
  }, [lineup]);

  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSORS[sortKey];
    const copy = [...players];
    copy.sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [players, sortKey, sortDir]);

  function handleHeaderClick(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="card max-h-[560px] overflow-y-auto p-0">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-base-800">
          <tr className="border-b border-base-600 text-left text-xs uppercase tracking-wide text-slate-400">
            {COLUMNS.map((col) => (
              <th
                key={col.label}
                className={`px-2.5 py-2 ${col.key ? "cursor-pointer select-none hover:text-slate-200" : ""}`}
                onClick={col.key ? () => handleHeaderClick(col.key as SortKey) : undefined}
              >
                {col.label}
                {col.key === sortKey ? (sortDir === "desc" ? " ▾" : " ▴") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const slotIndex = slotIndexByPlayerId.get(p.PlayerID);
            const selected = p.PlayerID === selectedPlayerId;
            return (
              <tr
                key={p.PlayerID}
                onClick={() => onSelect(p)}
                draggable
                onDragStart={(e) => {
                  // Round 16 (Aug 2026), Tyler: "click and drag" — a second,
                  // additive way to place a player alongside the existing
                  // click-then-click flow (onSelect above), not a
                  // replacement for it. SelectionGround.tsx's own Slot reads
                  // this same "text/plain" PlayerID back out on drop.
                  e.dataTransfer.setData("text/plain", String(p.PlayerID));
                  e.dataTransfer.effectAllowed = "move";
                }}
                className={`cursor-pointer border-b border-base-700/60 last:border-0 ${
                  selected ? "bg-accent/20" : "hover:bg-base-700/40"
                }`}
              >
                <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{p.jumperNumber}</td>
                <td className="px-2.5 py-1.5 font-medium">
                  {p.fname} {p.lname}
                </td>
                <td className="px-2.5 py-1.5 text-slate-400">{p.archetype}</td>
                <td className="px-2.5 py-1.5 tabular-nums">{p.Age}</td>
                <td className="px-2.5 py-1.5 tabular-nums font-semibold">{p.OVR}</td>
                <td className="px-2.5 py-1.5 tabular-nums text-accent-light">{p.POT}</td>
                <td className="px-2.5 py-1.5">
                  {slotIndex !== undefined ? (
                    <span className="stat-pill stat-pill-good">{POSITIONS[slotIndex]}</span>
                  ) : (
                    <span className="text-xs text-slate-600">&mdash;</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
