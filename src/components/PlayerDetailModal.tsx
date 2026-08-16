import type { Player, RatedAttribute } from "../types/player";
import { RATED_ATTRIBUTES, playerFullName } from "../types/player";
import { seedMorale } from "../engine/morale";
import { freeAgencyStatus } from "../engine/contracts";
import { fitnessBand, moraleBand, NumberWithPill, StatusPill, type PillTone } from "./StatusPill";

/**
 * Player Detail Modal — User Interface.md's shared component: header row,
 * ATTRIBUTES/CONTRACT/CONDITION+SCOUTING body, footer stats table. Built as
 * part of Phase 4 Slice 3 (Contracts needed a real CONTRACT display), but
 * deliberately generic — take a `Player` and an `onClose`, nothing
 * Contracts-specific — so Trade/Draft can reuse it unchanged once they
 * exist, exactly as User Interface.md itself asks for.
 *
 * Two sub-features from the reference spec are visible gaps here rather
 * than faked: an OVR-over-time projection chart (needs season-by-season
 * history no part of this app persists yet — see ROADMAP.md gap #35) and a
 * "Professionalism"/"Trend" scouting readout (not a modelled attribute
 * anywhere in Schema.md). Both are omitted with a short on-screen note
 * rather than invented. ATTRIBUTES shows all 20 of AussieFootySim's own rated
 * attributes rather than the reference site's smaller curated set — a
 * deliberate "improved modern version" call, not an oversight.
 */

const ATTRIBUTE_LABELS: Record<RatedAttribute, string> = {
  manMarking: "Man Marking",
  verticalLeap: "Vertical Leap",
  tenacity: "Tenacity",
  skill: "Skill",
  agility: "Agility",
  courage: "Courage",
  aggression: "Aggression",
  xFactor: "X-Factor",
  strengthGroundLevel: "Strength (Ground)",
  strengthOverhead: "Strength (Overhead)",
  strengthManOnMan: "Strength (Man-on-Man)",
  acceleration: "Acceleration",
  speed: "Speed",
  endurance: "Endurance",
  confidence: "Confidence",
  readPlay: "Read Play",
  consistancy: "Consistency",
  positioning: "Positioning",
  copeWithPressure: "Copes With Pressure",
  kickMaxDistance: "Kick Max Distance",
};

/** A letter grade for POT — Schema.md/Configuration.md only ever specify POT as a 1-99 number; this banding is a reasonable, disclosed display convenience, not a second source of truth (the number alongside it is always the real value). */
function potentialGrade(pot: number): string {
  if (pot >= 90) return "A+";
  if (pot >= 85) return "A";
  if (pot >= 80) return "A-";
  if (pot >= 75) return "B+";
  if (pot >= 70) return "B";
  if (pot >= 65) return "B-";
  if (pot >= 60) return "C+";
  if (pot >= 55) return "C";
  if (pot >= 50) return "C-";
  return "D";
}

const STATUS_TONE: Record<ReturnType<typeof freeAgencyStatus>, PillTone> = {
  Signed: "good",
  RFA: "warn",
  UFA: "bad",
  OOC: "warn",
};

/** Shared with Contracts.tsx — a single consistent $XXXk short-money format everywhere a salary/cap figure shows up. */
export function money(n: number): string {
  return `$${Math.round(n / 1000).toLocaleString()}k`;
}

function initials(p: Player): string {
  return `${p.fname[0] ?? ""}${p.lname[0] ?? ""}`.toUpperCase();
}

function AttrBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.max(0, (value / 99) * 100));
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums font-semibold">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-base-700">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STAT_COLUMNS: { key: keyof Player; label: string }[] = [
  { key: "stat_GM", label: "GM" },
  { key: "stat_DI", label: "DI" },
  { key: "stat_KI", label: "KI" },
  { key: "stat_HB", label: "HB" },
  { key: "stat_MK", label: "MK" },
  { key: "stat_TK", label: "TK" },
  { key: "stat_CL", label: "CL" },
  { key: "stat_GL", label: "GL" },
  { key: "stat_HO", label: "HO" },
  { key: "stat_CM", label: "CM" },
  { key: "stat_CP", label: "CP" },
  { key: "stat_UP", label: "UP" },
  { key: "stat_1pct", label: "1%" },
];
/** Which of the columns above are meaningful to show a per-game average for — games/goals/hitouts read fine as raw totals, the rest are more useful per-game. */
const PER_GAME_KEYS = new Set<keyof Player>(["stat_DI", "stat_KI", "stat_HB", "stat_MK", "stat_TK", "stat_CL", "stat_GL"]);

export interface PlayerDetailModalProps {
  player: Player | null;
  currentYear: number;
  onClose: () => void;
}

export function PlayerDetailModal({ player, currentYear, onClose }: PlayerDetailModalProps) {
  if (!player) return null;
  const p = player;

  const status = freeAgencyStatus(p, currentYear);
  const yearsLeft = Math.max(0, p.expired_year - currentYear);
  const fit = fitnessBand(p.condition);
  const mor = moraleBand(p.morale ?? seedMorale(p));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-card border border-base-600 bg-base-800 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-base-700 font-display text-lg italic text-slate-300">
              {initials(p)}
            </div>
            <div>
              <div className="font-display text-2xl italic">
                #{p.jumperNumber} {playerFullName(p)}
              </div>
              <div className="text-xs text-slate-400">
                {p.archetype} &middot; {p.Team} &middot; {p.homeState}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg bg-base-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-base-600" aria-label="Close">
            Close
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Age {p.Age} &middot; {p.height}cm &middot; {p.weight}kg &middot; Drafted {p.draft_year} (Pick {p.draft_pick}, {p.draft_draftType}) &middot; Origin:{" "}
          {p.OriginClub}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Attributes</div>
            <div className="space-y-1.5">
              {RATED_ATTRIBUTES.map((attr) => (
                <AttrBar key={attr} label={ATTRIBUTE_LABELS[attr]} value={p[attr]} />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Contract</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Salary</span>
                  <span className="tabular-nums font-semibold">{money(p.totalValue)}/yr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Years Left</span>
                  <span className="tabular-nums font-semibold">{yearsLeft}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <StatusPill label={status} tone={STATUS_TONE[status]} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Signed Since</span>
                  <span className="tabular-nums">{p.signed_year}</span>
                </div>
              </div>
              <div className="mt-1.5 text-[11px] text-slate-500">
                "Signed Since" is this contract's start year, not a full club-tenure history — no separate join-date is tracked yet.
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Condition</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Fitness</span>
                  <NumberWithPill value={p.condition} label={fit.label} tone={fit.tone} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Morale</span>
                  <NumberWithPill value={p.morale ?? seedMorale(p)} label={mor.label} tone={mor.tone} />
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Scouting</div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Overall</span>
                  <span className="tabular-nums font-semibold">{p.OVR}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Potential</span>
                  <span className="tabular-nums font-semibold">
                    {p.POT} <span className="text-accent-light">({potentialGrade(p.POT)})</span>
                  </span>
                </div>
              </div>
              <div className="mt-1.5 text-[11px] text-slate-500">
                An OVR-over-time chart and a Professionalism/Trend readout aren't shown — neither has real backing data yet (no season-history
                log, no modelled Professionalism attribute).
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Season Stats</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  {STAT_COLUMNS.map((c) => (
                    <th key={c.key} className="px-1 py-1 text-right font-normal">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-base-700">
                  {STAT_COLUMNS.map((c) => (
                    <td key={c.key} className="px-1 py-1 text-right tabular-nums font-semibold">
                      {p[c.key] as number}
                    </td>
                  ))}
                </tr>
                <tr className="text-slate-500">
                  {STAT_COLUMNS.map((c) => (
                    <td key={c.key} className="px-1 py-1 text-right tabular-nums">
                      {PER_GAME_KEYS.has(c.key) && p.stat_GM > 0 ? ((p[c.key] as number) / p.stat_GM).toFixed(1) : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="mt-1.5 text-[11px] text-slate-500">Top row: season totals. Bottom row: per game, where meaningful.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
