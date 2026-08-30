import { useMemo } from "react";
import type { Player } from "../types/player";
import { useGameStore, type SquadSortKey } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { NumberWithPill, fitnessBand, moraleBand } from "./StatusPill";
import { seedMorale } from "../engine/morale";
import { freeAgencyStatus } from "../engine/contracts";
import { PlayerLink } from "./PlayerLink";

/**
 * Squad list — see User Interface.md "Squad list": "A dense, sortable
 * table: # · Player · Pos (archetype) · Age · OVR · POT · FIT · FORM · MOR ·
 * Status". `FORM` is intentionally omitted here: it's a rolling-recent-form
 * stat that only means something once matches have actually been simulated
 * (see Engine.md season/career progression) — nothing honest to show yet.
 * Everything else shown is either real (`OVR`/`POT`/`Age`) or a clearly
 * documented seed (`MOR`, see engine/morale.ts).
 *
 * `FIT` prefers `liveCondition` (the active season's real, round-by-round
 * `Season.condition` map from engine/season.ts) over the static generated
 * `Player.condition` snapshot field whenever a season is in progress and has
 * an entry for that player — i.e. once at least one round has been
 * simulated. Before that (no season, or this player hasn't played yet this
 * season) it falls back to the static snapshot, same as always.
 *
 * `Status`'s contract read is against the live save year (useSaveStore.ts),
 * not a fixed constant — matters once a real off-season has advanced the
 * franchise past its starting year, otherwise every player's contract would
 * keep reading against year one forever. See ROADMAP.md's persistence
 * writeup.
 *
 * Once out of contract, the badge now shows the real RFA/UFA/OOC split
 * (engine/contracts.ts's `freeAgencyStatus`, added Phase 4 Slice 3) instead
 * of a flat "OOC" — the Contracts tab is where a coach actually acts on it.
 */
function contractStatus(p: Player, currentYear: number): { label: string; tone: "good" | "warn" | "bad" } {
  if (p.expired_year === currentYear) return { label: "FINAL YR", tone: "warn" };
  if (p.expired_year > currentYear) return { label: `Signed · ${p.expired_year - currentYear}yr`, tone: "good" };
  const status = freeAgencyStatus(p, currentYear);
  return { label: status, tone: status === "UFA" ? "bad" : "warn" };
}

const SORT_ACCESSORS: Record<SquadSortKey, (p: Player) => number | string> = {
  OVR: (p) => p.OVR,
  POT: (p) => p.POT,
  Age: (p) => p.Age,
  lname: (p) => p.lname,
  jumperNumber: (p) => p.jumperNumber,
};

const COLUMNS: { key: SquadSortKey | null; label: string; className?: string }[] = [
  { key: "jumperNumber", label: "#" },
  { key: "lname", label: "Player" },
  { key: null, label: "Pos" },
  { key: "Age", label: "Age" },
  { key: "OVR", label: "OVR" },
  { key: "POT", label: "POT" },
  { key: null, label: "FIT" },
  { key: null, label: "MOR" },
  { key: null, label: "Status" },
];

export function SquadList({ players, liveCondition }: { players: Player[]; liveCondition?: Map<number, number> }) {
  const { squadSortKey, squadSortDir, setSquadSort } = useGameStore();
  const currentYear = useSaveStore((s) => s.year);

  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSORS[squadSortKey];
    const copy = [...players];
    copy.sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return squadSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [players, squadSortKey, squadSortDir]);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-600 text-left text-xs uppercase tracking-wide text-slate-400">
            {COLUMNS.map((col) => (
              <th
                key={col.label}
                className={`px-3 py-2 ${col.key ? "cursor-pointer select-none hover:text-slate-200" : ""}`}
                onClick={col.key ? () => setSquadSort(col.key as SquadSortKey) : undefined}
              >
                {col.label}
                {col.key === squadSortKey ? (squadSortDir === "desc" ? " ▾" : " ▴") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const condition = liveCondition?.get(p.PlayerID) ?? p.condition;
            const fit = fitnessBand(condition);
            const mor = moraleBand(seedMorale(p));
            const status = contractStatus(p, currentYear);
            return (
              <tr key={p.PlayerID} className="border-b border-base-700/60 last:border-0 hover:bg-base-700/40">
                <td className="px-3 py-2 tabular-nums text-slate-400">{p.jumperNumber}</td>
                <td className="px-3 py-2 font-medium">
                  <PlayerLink player={p} />
                </td>
                <td className="px-3 py-2 text-slate-400">{p.archetype}</td>
                <td className="px-3 py-2 tabular-nums">{p.Age}</td>
                <td className="px-3 py-2 tabular-nums font-semibold">{p.OVR}</td>
                <td className="px-3 py-2 tabular-nums text-accent-light">{p.POT}</td>
                <td className="px-3 py-2">
                  <NumberWithPill value={condition} label={fit.label} tone={fit.tone} />
                </td>
                <td className="px-3 py-2">
                  <NumberWithPill value={seedMorale(p)} label={mor.label} tone={mor.tone} />
                </td>
                <td className="px-3 py-2">
                  <span className={`stat-pill stat-pill-${status.tone}`}>{status.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
