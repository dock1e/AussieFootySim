import { useMemo } from "react";
import type { Player } from "../types/player";
import { useGameStore, type SquadSortKey } from "../store/useGameStore";
import { NumberWithPill, fitnessBand, moraleBand } from "./StatusPill";
import { seedMorale } from "../engine/morale";
import { CURRENT_SEASON_YEAR } from "../config";

/**
 * Squad list — see User Interface.md "Squad list": "A dense, sortable
 * table: # · Player · Pos (archetype) · Age · OVR · POT · FIT · FORM · MOR ·
 * Status". `FORM` is intentionally omitted here: it's a rolling-recent-form
 * stat that only means something once matches have actually been simulated
 * (see Engine.md season/career progression) — nothing honest to show yet.
 * Everything else shown is either real (`OVR`/`POT`/`Age`) or a clearly
 * documented seed (`MOR`, see engine/morale.ts).
 */
function contractStatus(p: Player): { label: string; tone: "good" | "warn" | "bad" } {
  if (p.expired_year < CURRENT_SEASON_YEAR) return { label: "OOC", tone: "bad" };
  if (p.expired_year === CURRENT_SEASON_YEAR) return { label: "FINAL YR", tone: "warn" };
  return { label: `Signed · ${p.expired_year - CURRENT_SEASON_YEAR}yr`, tone: "good" };
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

export function SquadList({ players }: { players: Player[] }) {
  const { squadSortKey, squadSortDir, setSquadSort } = useGameStore();

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
            const fit = fitnessBand(p.condition);
            const mor = moraleBand(seedMorale(p));
            const status = contractStatus(p);
            return (
              <tr key={p.PlayerID} className="border-b border-base-700/60 last:border-0 hover:bg-base-700/40">
                <td className="px-3 py-2 tabular-nums text-slate-400">{p.jumperNumber}</td>
                <td className="px-3 py-2 font-medium">
                  {p.fname} {p.lname}
                </td>
                <td className="px-3 py-2 text-slate-400">{p.archetype}</td>
                <td className="px-3 py-2 tabular-nums">{p.Age}</td>
                <td className="px-3 py-2 tabular-nums font-semibold">{p.OVR}</td>
                <td className="px-3 py-2 tabular-nums text-accent-light">{p.POT}</td>
                <td className="px-3 py-2">
                  <NumberWithPill value={p.condition} label={fit.label} tone={fit.tone} />
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
