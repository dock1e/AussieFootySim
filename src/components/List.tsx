import { useMemo, useState } from "react";
import { useGameStore, type SquadSortKey } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { ALL_PLAYERS, getPlayersByClub } from "../data/loadPlayers";
import { ARCHETYPE_LINE, LINES, type Line } from "../data/lines";
import { ARCHETYPES } from "../types/archetype";
import type { Archetype } from "../types/archetype";
import { ARCHETYPE_FRAME } from "../engine/progression";
import { archetypeFitScore, justificationFor, SWITCH_MARGIN } from "../engine/positionSwitch";
import {
  freeAgencyStatus,
  allClubCapRows,
  statedAsk,
  evaluateOffer,
  SALARY_CAP,
  type FreeAgencyStatus,
  type OfferOutcome,
} from "../engine/contracts";
import type { Player, RatedAttribute } from "../types/player";
import { playerFullName } from "../types/player";
import { money } from "./PlayerDetailModal";
import { PlayerLink } from "./PlayerLink";
import { Card, DetailPanel, SectionLabel, StatusChip, KpiTile, BarSolidGhost, Segmented, type StatusTone } from "./theme/primitives";

/**
 * Round 117 — [[Club Theme System]] List rebuild (brief section 4.3, `isList`).
 * Replaces the bare `SquadList` table (round 51-era, Tailwind stat-pills) with
 * the brief's full 3-column layout: a salary-cap KPI band, a left filter rail
 * (contract status / position / contracts-ending calendar), the dense playing
 * list table, and a sticky right detail panel with Contract and Position Fit
 * tabs. Own-club roster management only — the free-agency market, salary-cap
 * breakdown across all 18 clubs, and the League Activity feed stay on the
 * separate Contracts.tsx tab (App.tsx's "contracts" screen), since the brief's
 * List screen is specifically about *your* list, not the whole league's.
 * `PositionSwitch.tsx`'s batch review queue also stays as its own tab — this
 * screen's Position Fit tab is a single-player, on-demand version of the same
 * underlying `engine/positionSwitch.ts` functions for whichever player is
 * selected, not a replacement for the "review everyone at once" workflow.
 *
 * No new mechanics: every number here comes from `engine/contracts.ts` and
 * `engine/positionSwitch.ts`, already built and calibrated in earlier rounds.
 * One disclosed UI-only construction: the brief's Position Fit rows are
 * labelled "NOW -> AFTER RETRAINING", implying a gradual attribute-shift
 * mechanic that doesn't exist — `engine/positionSwitch.ts`'s own doc comment
 * is explicit that a switch only relabels `archetype` and recomputes `OVR`;
 * attributes themselves never change. This screen shows the real thing
 * instead: each same-frame archetype's current fit score, and what `OVR`
 * would actually read if switched right now (`archetypeFitScore` +
 * `recomputeOVR`'s own merge-and-slice pattern, both already exported).
 * Likewise "chance he signs" is `evaluateOffer`'s own real 70%/95%-of-ask
 * thresholds rendered as a bar, not a new probability model.
 */

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

const LINE_SHORT: Record<Line, string> = { Midfield: "MID", Forwards: "FWD", Defence: "DEF", Ruck: "RUC" };

const STATUS_TONE: Record<FreeAgencyStatus, StatusTone> = { Signed: "good", RFA: "warn", OOC: "warn", UFA: "bad" };

type StatusFilter = FreeAgencyStatus | "All";
type LineFilter = Line | "All";

function otherSameFrameArchetypes(current: Archetype): Archetype[] {
  const frame = ARCHETYPE_FRAME[current];
  return ARCHETYPES.filter((a) => a !== current && ARCHETYPE_FRAME[a] === frame);
}

export function List() {
  const myClub = useGameStore((s) => s.myClub);
  const { squadSortKey, squadSortDir, setSquadSort } = useGameStore();
  const currentYear = useSaveStore((s) => s.year);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const reSignPlayer = useSaveStore((s) => s.reSignPlayer);
  const delistPlayer = useSaveStore((s) => s.delistPlayer);
  const applyPositionSwitch = useSaveStore((s) => s.applyPositionSwitch);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [lineFilter, setLineFilter] = useState<LineFilter>("All");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<"contract" | "position">("contract");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const squad = useMemo(() => getPlayersByClub(myClub), [myClub, poolVersion]);
  const capRow = useMemo(() => allClubCapRows(ALL_PLAYERS, currentYear).find((r) => r.clubName === myClub), [currentYear, poolVersion, myClub]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusCounts = useMemo(() => {
    const counts: Record<FreeAgencyStatus, number> = { Signed: 0, RFA: 0, OOC: 0, UFA: 0 };
    for (const p of squad) counts[freeAgencyStatus(p, currentYear)]++;
    return counts;
  }, [squad, currentYear]);

  const lineCounts = useMemo(() => {
    const counts: Record<Line, number> = { Midfield: 0, Forwards: 0, Defence: 0, Ruck: 0 };
    for (const p of squad) counts[ARCHETYPE_LINE[p.archetype as Archetype]]++;
    return counts;
  }, [squad]);

  const endingByYear = useMemo(() => {
    const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4];
    return years.map((yr) => ({ yr, n: squad.filter((p) => p.expired_year === yr).length }));
  }, [squad, currentYear]);
  const maxEnding = Math.max(1, ...endingByYear.map((y) => y.n));

  const filtered = useMemo(() => {
    return squad.filter((p) => {
      if (statusFilter !== "All" && freeAgencyStatus(p, currentYear) !== statusFilter) return false;
      if (lineFilter !== "All" && ARCHETYPE_LINE[p.archetype as Archetype] !== lineFilter) return false;
      return true;
    });
  }, [squad, statusFilter, lineFilter, currentYear]);

  const SORT_ACCESSORS: Record<SquadSortKey, (p: Player) => number | string> = {
    OVR: (p) => p.OVR,
    POT: (p) => p.POT,
    Age: (p) => p.Age,
    lname: (p) => p.lname,
    jumperNumber: (p) => p.jumperNumber,
  };
  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSORS[squadSortKey];
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return squadSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, squadSortKey, squadSortDir]);

  const selected = squad.find((p) => p.PlayerID === selectedId) ?? null;

  const avgAge = squad.length > 0 ? Math.round((squad.reduce((s, p) => s + p.Age, 0) / squad.length) * 10) / 10 : 0;
  const finalYrCount = squad.filter((p) => p.expired_year === currentYear).length;
  const nextYrCount = squad.filter((p) => p.expired_year === currentYear + 1).length;

  return (
    <div className="flex flex-col gap-3">
      {/* KPI band */}
      <Card padding="14px 18px">
        <div className="flex flex-wrap items-center gap-6">
          <div style={{ flex: "2 1 280px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <SectionLabel>Salary Cap</SectionLabel>
              <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff" }}>
                {capRow ? `${money(capRow.wages)} / ${money(SALARY_CAP)}` : "—"}
              </span>
            </div>
            {capRow && <BarSolidGhost solid={Math.min(1, capRow.capPct)} ghost={0.6} />}
            <div style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>
              {capRow ? `${(capRow.capPct * 100).toFixed(1)}% of cap · ${money(capRow.headroom)} headroom` : ""}
            </div>
          </div>
          <KpiTile value={squad.length} label="List spots · 24-46 permitted" />
          <KpiTile value={finalYrCount} label={`Out of contract · end of ${currentYear}`} tone={finalYrCount > 0 ? "accent" : "neutral"} />
          <KpiTile value={nextYrCount} label={`Expires ${currentYear + 1} · final year`} />
          <KpiTile value={avgAge} label="Avg age · whole list" />
        </div>
      </Card>

      <div className="flex flex-wrap items-start gap-3">
        {/* Left filter rail */}
        <Card style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <SectionLabel style={{ marginBottom: 8 }}>Contract Status</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <FilterRow label="All" count={squad.length} active={statusFilter === "All"} onClick={() => setStatusFilter("All")} />
              {(["Signed", "RFA", "OOC", "UFA"] as FreeAgencyStatus[]).map((s) => (
                <FilterRow key={s} label={s} count={statusCounts[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
              ))}
            </div>
          </div>
          <div>
            <SectionLabel style={{ marginBottom: 8 }}>Position</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <FilterRow label="All" count={squad.length} active={lineFilter === "All"} onClick={() => setLineFilter("All")} />
              {LINES.map((l) => (
                <FilterRow key={l} label={l} count={lineCounts[l]} active={lineFilter === l} onClick={() => setLineFilter(l)} />
              ))}
            </div>
          </div>
          <div>
            <SectionLabel style={{ marginBottom: 8 }}>Contracts Ending</SectionLabel>
            <div className="flex flex-col gap-1">
              {endingByYear.map((y) => (
                <div key={y.yr} style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr) 20px", gap: 8, alignItems: "center" }}>
                  <span style={{ font: "600 11px 'IBM Plex Mono',monospace", color: "#aab3c3" }}>{y.yr}</span>
                  <span style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.06)", overflow: "hidden", display: "block" }}>
                    <span style={{ display: "block", height: "100%", width: `${(y.n / maxEnding) * 100}%`, background: "var(--acc)" }} />
                  </span>
                  <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff", textAlign: "right" }}>{y.n}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Playing list table */}
        <Card style={{ flex: "4 1 560px", minWidth: 0, padding: 0, overflow: "hidden" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2" style={{ padding: "14px 16px 10px" }}>
            <div className="flex items-baseline gap-2">
              <span style={{ font: "700 20px 'Barlow Condensed',sans-serif", color: "#fff" }}>Playing list</span>
              <span style={{ font: "500 12px 'IBM Plex Mono',monospace", color: "#8f9ab0" }}>{sorted.length}</span>
            </div>
            <span style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>Click a column to sort · click a player to manage</span>
          </div>
          <div style={{ overflow: "auto", maxHeight: 680, borderTop: "1px solid rgba(255,255,255,.07)" }}>
            <div style={{ minWidth: 700 }}>
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  display: "grid",
                  gap: 8,
                  alignItems: "center",
                  padding: "0 12px",
                  height: 34,
                  background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)",
                  borderBottom: "1px solid rgba(255,255,255,.1)",
                  font: "600 10px 'IBM Plex Mono',monospace",
                  letterSpacing: ".8px",
                  color: "#8f9ab0",
                  gridTemplateColumns: "36px minmax(170px,1fr) 40px 44px 44px 52px 64px 100px",
                }}
              >
                <HeadCell label="#" sortKey="jumperNumber" current={squadSortKey} dir={squadSortDir} onSort={setSquadSort} />
                <HeadCell label="PLAYER" sortKey="lname" current={squadSortKey} dir={squadSortDir} onSort={setSquadSort} />
                <span style={{ textAlign: "center" }}>AGE</span>
                <HeadCell label="OVR" sortKey="OVR" current={squadSortKey} dir={squadSortDir} onSort={setSquadSort} align="center" />
                <HeadCell label="POT" sortKey="POT" current={squadSortKey} dir={squadSortDir} onSort={setSquadSort} align="center" />
                <span style={{ textAlign: "center" }}>ENDS</span>
                <span style={{ textAlign: "center" }}>SAL</span>
                <span style={{ textAlign: "center" }}>STATUS</span>
              </div>
              {sorted.map((p) => {
                const status = freeAgencyStatus(p, currentYear);
                const isSelected = p.PlayerID === selectedId;
                const line = ARCHETYPE_LINE[p.archetype as Archetype];
                const switched = p.archetype_reason?.startsWith("Position Switch:");
                const rookie = p.draft_draftType === "Rookie Draft";
                return (
                  <div
                    key={p.PlayerID}
                    onClick={() => {
                      setSelectedId(p.PlayerID);
                      setPanelTab("contract");
                    }}
                    style={{
                      display: "grid",
                      gap: 8,
                      alignItems: "center",
                      padding: "0 12px",
                      height: 40,
                      cursor: "pointer",
                      gridTemplateColumns: "36px minmax(170px,1fr) 40px 44px 44px 52px 64px 100px",
                      background: isSelected ? "color-mix(in oklch, var(--acc) 18%, transparent)" : "transparent",
                      boxShadow: isSelected ? "inset 3px 0 0 var(--acc)" : undefined,
                      borderBottom: "1px solid rgba(255,255,255,.05)",
                    }}
                  >
                    <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>{p.jumperNumber}</span>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <PlayerLink player={p} as="span" className="!text-inherit" />
                      </span>
                      <span style={{ font: "500 11px Barlow,sans-serif", color: "#8f9ab0", whiteSpace: "nowrap" }}>{LINE_SHORT[line]}</span>
                      {switched && <span style={{ font: "600 11px Barlow,sans-serif", color: "var(--accT)" }} title="Position-switched">⇄</span>}
                      {rookie && <span style={{ font: "600 9px 'IBM Plex Mono',monospace", letterSpacing: ".7px", color: "#8f9ab0" }}>RK</span>}
                    </span>
                    <span style={{ textAlign: "center", font: "500 12px 'IBM Plex Mono',monospace", color: "#aab3c3" }}>{p.Age}</span>
                    <span style={{ textAlign: "center", font: "600 13px 'IBM Plex Mono',monospace", color: "#fff" }}>{p.OVR}</span>
                    <span style={{ textAlign: "center", font: "600 13px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>{p.POT}</span>
                    <span style={{ textAlign: "center", font: "500 12px 'IBM Plex Mono',monospace", color: "#c3ccdd" }}>{p.expired_year}</span>
                    <span style={{ textAlign: "center", font: "500 12px 'IBM Plex Mono',monospace", color: "#c3ccdd" }}>{money(p.totalValue)}</span>
                    <span style={{ display: "flex", justifyContent: "center" }}>
                      <StatusChip tone={STATUS_TONE[status]}>{status}</StatusChip>
                    </span>
                  </div>
                );
              })}
              {sorted.length === 0 && <div style={{ padding: "24px 16px", font: "400 14px Barlow,sans-serif", color: "#aab3c3" }}>Nothing matches these filters.</div>}
            </div>
          </div>
        </Card>

        {/* Detail panel */}
        <div style={{ flex: "1.6 1 340px", minWidth: 0, position: "sticky", top: 12 }}>
          {selected ? (
            <DetailPanel>
              <PlayerDetail
                player={selected}
                currentYear={currentYear}
                tab={panelTab}
                onTab={setPanelTab}
                onReSign={(terms) => reSignPlayer(selected.PlayerID, terms)}
                onDelist={() => {
                  delistPlayer(selected.PlayerID);
                  setSelectedId(null);
                }}
                onSwitch={(a) => applyPositionSwitch(selected.PlayerID, a)}
              />
            </DetailPanel>
          ) : (
            <DetailPanel>
              <div style={{ padding: "24px 4px", textAlign: "center", font: "500 13px Barlow,sans-serif", color: "#8f9ab0" }}>
                Click a player to manage their contract or check their position fit.
              </div>
            </DetailPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterRow({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        borderRadius: 6,
        border: 0,
        background: active ? "var(--acc)" : "transparent",
        color: active ? "var(--on)" : "#c3ccdd",
        font: "500 13px Barlow,sans-serif",
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      <span
        style={{
          font: "600 11px 'IBM Plex Mono',monospace",
          color: active ? "var(--on)" : "#8f9ab0",
        }}
      >
        {count}
      </span>
    </button>
  );
}

function HeadCell({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align,
}: {
  label: string;
  sortKey: SquadSortKey;
  current: SquadSortKey;
  dir: "asc" | "desc";
  onSort: (k: SquadSortKey) => void;
  align?: "center";
}) {
  const active = sortKey === current;
  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{
        border: 0,
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        textAlign: align ?? "left",
        color: active ? "var(--accT)" : "#8f9ab0",
        font: "600 10px 'IBM Plex Mono',monospace",
        letterSpacing: ".8px",
      }}
    >
      {label}
      {active ? (dir === "desc" ? " ▾" : " ▴") : ""}
    </button>
  );
}

function PlayerDetail({
  player,
  currentYear,
  tab,
  onTab,
  onReSign,
  onDelist,
  onSwitch,
}: {
  player: Player;
  currentYear: number;
  tab: "contract" | "position";
  onTab: (t: "contract" | "position") => void;
  onReSign: (terms: { years: number; salaryPerYear: number }) => void;
  onDelist: () => void;
  onSwitch: (a: Archetype) => void;
}) {
  const status = freeAgencyStatus(player, currentYear);
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span style={{ font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: "1.2px", color: "var(--accT)" }}>
            #{player.jumperNumber} · {player.draft_draftType === "Rookie Draft" ? "Rookie List" : "Primary List"}
          </span>
          <StatusChip tone={STATUS_TONE[status]}>{status}</StatusChip>
        </div>
        <div style={{ font: "700 26px/1.05 'Barlow Condensed',sans-serif", color: "#fff", marginTop: 4 }}>{playerFullName(player)}</div>
        <div style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3", marginTop: 3 }}>
          {player.archetype} · Age {player.Age}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile value={player.OVR} label="OVR" />
        <StatTile value={player.POT} label="Ceiling" tone="accent" />
        <StatTile value={money(player.totalValue)} label={`Salary · to ${player.expired_year}`} />
      </div>

      <Segmented
        options={[
          { value: "contract", label: "Contract" },
          { value: "position", label: "Position Fit" },
        ]}
        value={tab}
        onChange={onTab}
      />

      {tab === "contract" ? (
        <ContractTab player={player} onReSign={onReSign} onDelist={onDelist} />
      ) : (
        <PositionFitTab player={player} onSwitch={onSwitch} />
      )}

      <button
        onClick={() => import("../store/usePlayerProfileStore").then((m) => m.usePlayerProfileStore.getState().openPlayer(player.PlayerID))}
        style={{
          marginTop: "auto",
          background: "transparent",
          color: "#dfe5ee",
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: 9,
          padding: "10px 14px",
          font: "600 13px Barlow,sans-serif",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Open career profile
      </button>
    </div>
  );
}

function StatTile({ value, label, tone }: { value: React.ReactNode; label: string; tone?: "accent" }) {
  return (
    <div style={{ padding: "10px 6px", borderRadius: 9, background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.07)", textAlign: "center" }}>
      <div style={{ font: "700 22px/1 'Barlow Condensed',sans-serif", color: tone === "accent" ? "var(--accT)" : "#fff" }}>{value}</div>
      <div style={{ font: "600 9px 'IBM Plex Mono',monospace", letterSpacing: ".8px", color: "#8f9ab0", marginTop: 5, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

/**
 * Inline re-sign/delist negotiation — the same real `evaluateOffer` 3-offer
 * flow `Contracts.tsx`'s `NegotiationModal` uses, embedded directly in the
 * panel per the brief's markup rather than a popup. A currently-signed
 * player (not yet out of contract) can still be extended early, matching
 * `Contracts.tsx`'s own "Your Out-of-Contract Players" convention of using
 * `statedAsk`/`totalValue` as the negotiation anchor regardless of status.
 */
function ContractTab({ player, onReSign, onDelist }: { player: Player; onReSign: (terms: { years: number; salaryPerYear: number }) => void; onDelist: () => void }) {
  const ask = statedAsk(player);
  const [years, setYears] = useState(3);
  const [salary, setSalary] = useState(ask);
  const [offersUsed, setOffersUsed] = useState(0);
  const [outcome, setOutcome] = useState<OfferOutcome | null>(null);

  // A real-time readout of evaluateOffer's own 70%/95%-of-ask thresholds —
  // 0% at or below the reject line, 100% at or above the accept line, linear
  // between. Not a new probability model, just a visualisation of the
  // existing deterministic rule so the coach can see where an offer sits
  // before submitting it.
  const pct = Math.max(0, Math.min(1, (salary / ask - 0.7) / (0.95 - 0.7)));

  function submitOffer() {
    const result = evaluateOffer(player, salary, offersUsed, 3);
    setOffersUsed((n) => n + 1);
    setOutcome(result);
    if (result.result === "accepted") onReSign({ years, salaryPerYear: salary });
  }

  const offersLeft = 3 - offersUsed;

  return (
    <div className="flex flex-col gap-3">
      <div style={{ padding: "10px 12px", borderRadius: 9, background: "rgba(240,196,25,.07)", border: "1px solid rgba(240,196,25,.25)", font: "500 13px/1.45 Barlow,sans-serif", color: "#ecdcaa" }}>
        His manager is asking for <b>{money(ask)}/yr</b>.
      </div>
      <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(0,0,0,.2)", border: "1px solid rgba(255,255,255,.07)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="flex justify-between">
          <SectionLabel>Years</SectionLabel>
          <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff" }}>{player.expired_year}</span>
        </div>
        <div className="grid grid-cols-6 gap-0.5">
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <button
              key={y}
              onClick={() => setYears(y)}
              style={{
                border: 0,
                borderRadius: 5,
                padding: "6px 0",
                background: years === y ? "var(--acc)" : "rgba(255,255,255,.06)",
                color: years === y ? "var(--on)" : "#aab3c3",
                font: "600 12px 'IBM Plex Mono',monospace",
                cursor: "pointer",
              }}
            >
              {y}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2.5">
          <span style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3" }}>Salary a year</span>
          <span className="flex items-center gap-2">
            <StepButton onClick={() => setSalary((s) => Math.max(140_000, s - 25_000))}>−</StepButton>
            <span style={{ font: "700 16px 'IBM Plex Mono',monospace", color: "#fff", minWidth: 78, textAlign: "center" }}>{money(salary)}</span>
            <StepButton onClick={() => setSalary((s) => s + 25_000)}>+</StepButton>
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between">
            <span style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>Chance he signs</span>
            <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: pct >= 1 ? "#4fd69a" : pct <= 0 ? "#ff8a7a" : "#f0c04a" }}>{Math.round(pct * 100)}%</span>
          </div>
          <span style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden", display: "block" }}>
            <span style={{ display: "block", height: "100%", width: `${pct * 100}%`, background: "var(--acc)" }} />
          </span>
        </div>
      </div>

      {outcome?.result === "countered" && (
        <div style={{ padding: "10px 12px", borderRadius: 9, background: "rgba(255,255,255,.05)", font: "500 13px Barlow,sans-serif", color: "#dfe5ee" }}>
          Counters at <b>{money(outcome.counterSalaryPerYear)}/yr</b>.
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onReSign({ years, salaryPerYear: outcome.counterSalaryPerYear })}
              style={{ background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 7, padding: "6px 10px", font: "700 12px Barlow,sans-serif", cursor: "pointer" }}
            >
              Accept Counter
            </button>
            <button
              onClick={() => {
                setSalary(outcome.counterSalaryPerYear);
                setOutcome(null);
              }}
              style={{ background: "rgba(255,255,255,.06)", color: "#c3ccdd", border: 0, borderRadius: 7, padding: "6px 10px", font: "600 12px Barlow,sans-serif", cursor: "pointer" }}
            >
              Adjust
            </button>
          </div>
        </div>
      )}
      {outcome?.result === "rejected" && (
        <div style={{ padding: "10px 12px", borderRadius: 9, background: "rgba(255,138,122,.08)", font: "500 13px Barlow,sans-serif", color: "#ff8a7a" }}>
          {offersLeft > 0 ? "Offer rejected — too far below their ask." : "Offer rejected — no offers left this window."}
        </div>
      )}

      {outcome?.result !== "countered" && offersLeft > 0 && (
        <button
          onClick={submitOffer}
          style={{ background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 9, padding: "12px 16px", font: "700 14px Barlow,sans-serif", cursor: "pointer", width: "100%" }}
        >
          Offer contract
        </button>
      )}
      <button
        onClick={onDelist}
        style={{ background: "transparent", color: "#ffa37a", border: "1px solid rgba(255,163,122,.35)", borderRadius: 9, padding: "10px 14px", font: "600 13px Barlow,sans-serif", cursor: "pointer" }}
      >
        Delist
      </button>
    </div>
  );
}

function StepButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(255,255,255,.16)", background: "transparent", color: "#fff", font: "600 15px Barlow,sans-serif", cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

/**
 * A real, on-demand `engine/positionSwitch.ts` read — every same-frame
 * archetype's real `archetypeFitScore`, not just the single best candidate
 * `findSwitchCandidates` surfaces for the batch review queue. Recomputes a
 * preview OVR only for whichever archetype currently sits best (the same
 * merge-into-`ALL_PLAYERS`-and-slice pattern the engine file itself uses),
 * since doing that per-row for all 5-8 candidates would be needlessly
 * expensive for a value nothing else on this tab needs.
 */
function PositionFitTab({ player, onSwitch }: { player: Player; onSwitch: (a: Archetype) => void }) {
  const current = player.archetype as Archetype;
  const currentFit = archetypeFitScore(player, current);
  const others = otherSameFrameArchetypes(current);
  const fits = others
    .map((a) => ({ archetype: a, fit: archetypeFitScore(player, a) }))
    .sort((a, b) => b.fit - a.fit);
  const best = fits[0];
  const bestMargin = best ? (best.fit - currentFit) / currentFit : 0;
  const hasTarget = best && bestMargin >= SWITCH_MARGIN;
  const maxFit = Math.max(currentFit, ...fits.map((f) => f.fit));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex justify-between">
        <SectionLabel>Position Fit</SectionLabel>
        <span style={{ font: "500 10px 'IBM Plex Mono',monospace", color: "#8f9ab0" }}>RAW FIT SCORE</span>
      </div>
      <div className="flex flex-col gap-1">
        <FitRow archetype={current} fit={currentFit} maxFit={maxFit} isCurrent />
        {fits.map((f) => (
          <FitRow key={f.archetype} archetype={f.archetype} fit={f.fit} maxFit={maxFit} />
        ))}
      </div>
      {hasTarget && best && (
        <>
          <div style={{ padding: "10px 12px", borderRadius: 9, background: "color-mix(in oklch, var(--acc) 10%, rgba(0,0,0,.2))", border: "1px solid color-mix(in oklch, var(--acc) 30%, transparent)", font: "500 13px/1.45 Barlow,sans-serif", color: "#dfe5ee" }}>
            Driven by: {justificationFor(player, best.archetype).map((a) => ATTR_LABEL[a]).join(", ")}
          </div>
          <button
            onClick={() => onSwitch(best.archetype)}
            style={{ background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 9, padding: "12px 16px", font: "700 14px Barlow,sans-serif", cursor: "pointer", width: "100%" }}
          >
            Switch to {best.archetype}
          </button>
        </>
      )}
      {!hasTarget && (
        <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>
          {current} is still this player's best-fitting archetype — nothing else clears the switch margin.
        </div>
      )}
    </div>
  );
}

function FitRow({ archetype, fit, maxFit, isCurrent }: { archetype: Archetype; fit: number; maxFit: number; isCurrent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 7, background: "rgba(0,0,0,.2)", border: "1px solid rgba(255,255,255,.05)" }}>
      <span style={{ flex: "0 0 150px", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ font: "600 13px Barlow,sans-serif", color: "#eef2f8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{archetype}</span>
        {isCurrent && <span style={{ font: "600 9px 'IBM Plex Mono',monospace", letterSpacing: ".8px", color: "var(--accT)" }}>CURRENT</span>}
      </span>
      <span style={{ position: "relative", flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${(fit / maxFit) * 100}%`, background: isCurrent ? "rgba(255,255,255,.35)" : "var(--acc)" }} />
      </span>
      <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff", textAlign: "right", whiteSpace: "nowrap", flex: "0 0 40px" }}>{fit.toFixed(1)}</span>
    </div>
  );
}
