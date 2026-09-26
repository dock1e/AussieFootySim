import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { ALL_PLAYERS, getPlayersByClub } from "../data/loadPlayers";
import { playerFullName, type Player } from "../types/player";
import { simCareerSpan, ALL_RECORD_CATEGORIES } from "../engine/records";
import { populationOvrStats } from "../engine/progression";
import { projectOvrTrajectory, topRecordChasesFor, estimatedRemainingGames, type OvrTrajectory } from "../engine/careerProjection";
import { computeSeasonGrades } from "../engine/seasonGrading";
import { ALL_LEAGUE_STATS, type LeagueStat } from "../engine/seasonSummary";
import { draftHistoryFor } from "../data/realDraftHistory";
import { yearRowsFor, sumYearRows, type YearRow } from "./PlayerProfileModal";
import { Card, HeroCard, Watermark, SectionLabel, StatusChip, KpiTile, PinStar } from "./theme/primitives";

/**
 * Round 118 — [[Club Theme System]] Player Career screen (brief `Club Theme System.dc.html`
 * lines 215-334, the `isPlayer` block). Rebuilds the modal-based career view
 * (`PlayerProfileModal.tsx`) into a standalone themed screen, reusing every real mechanic that
 * already exists — season totals (`yearRowsFor`/`sumYearRows`), benchmarking, all-time records
 * (`combinedRecordFor` via `careerProjection.ts`), season grading, and the round-115 watchlist
 * (`useSaveStore`'s `watchlist`/`togglePin`) — rather than reinventing any of them. `PlayerProfileModal`
 * itself is untouched and still opens as a quick-look overlay from every `PlayerLink` elsewhere in the
 * app; this screen is the deeper, dedicated destination for your OWN club's roster.
 *
 * **The one real data gap this screen hits, disclosed rather than faked**: nothing in this codebase
 * persists a player's OVR at the end of each past season, so the brief's "OVR by season" arc can only
 * ever have a single genuine ACTUAL point (today). The PROJECTED (dashed) line and PROJECTED PEAK tile
 * are a real, computed forward projection instead — see `engine/careerProjection.ts`'s own doc comment
 * for exactly how, and why it's a disclosed approximation rather than an invented curve. The
 * Season-by-Season table's "per game" column is the focus stat's own rate, not a fabricated per-season
 * OVR history.
 */
export function CareerProfile() {
  const myClub = useGameStore((s) => s.myClub);
  const currentYear = useSaveStore((s) => s.year);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const watchlist = useSaveStore((s) => s.watchlist);
  const togglePin = useSaveStore((s) => s.togglePin);
  const clubHistory = useSaveStore((s) => s.clubHistory);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const season = useSeasonStore((s) => s.season);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statKey, setStatKey] = useState<LeagueStat>("goals");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const squad = useMemo(() => getPlayersByClub(myClub), [myClub, poolVersion]);
  const player = squad.find((p) => p.PlayerID === selectedId) ?? squad[0] ?? null;

  const populationStats = useMemo(() => populationOvrStats(ALL_PLAYERS), [poolVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!player) {
    return (
      <Card>
        <div style={{ padding: "24px 4px", textAlign: "center", font: "500 13px Barlow,sans-serif", color: "#aab3c3" }}>No players on your list yet.</div>
      </Card>
    );
  }

  const pinned = watchlist.includes(player.PlayerID);
  const span = simCareerSpan(player, seasonArchives, season, currentYear);
  const liveGrade = season ? computeSeasonGrades(season, currentYear, seasonArchives, ALL_PLAYERS)[player.PlayerID]?.grade : undefined;
  const yearRows = yearRowsFor(player, seasonArchives, season, currentYear, liveGrade);
  const careerTotals = sumYearRows(player.PlayerID, yearRows);
  const gamesPlayed = careerTotals?.gamesPlayed ?? 0;

  const trajectory: OvrTrajectory = projectOvrTrajectory(player, currentYear, populationStats, 10);
  const remainingGames = estimatedRemainingGames(trajectory);
  const chases = topRecordChasesFor(player.PlayerID, gamesPlayed, remainingGames, ALL_RECORD_CATEGORIES, seasonArchives, season, 2);

  const draftEntries = draftHistoryFor(player.realFullName ?? playerFullName(player));
  const historyEntries = clubHistory[player.PlayerID] ?? [];
  const statMeta = ALL_LEAGUE_STATS.find((s) => s.key === statKey) ?? ALL_LEAGUE_STATS[0];
  const focusTotal = careerTotals ? careerTotals[statKey] : 0;

  const milestones = buildMilestones(yearRows, historyEntries, draftEntries);

  return (
    <div className="flex flex-col gap-3">
      <PlayerSelector squad={squad} selected={player} onSelect={setSelectedId} pinnedIds={watchlist} onTogglePin={togglePin} />

      <div className="flex flex-wrap items-start gap-3">
        <HeroCard style={{ flex: "3 1 480px", minWidth: 0, position: "relative" }}>
          <Watermark>{player.jumperNumber}</Watermark>
          <div style={{ position: "relative" }}>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>{player.archetype}</SectionLabel>
              <PinStar pinned={pinned} onToggle={() => togglePin(player.PlayerID)} />
            </div>
            <div style={{ font: "700 32px/1.05 'Barlow Condensed',sans-serif", color: "#fff", marginTop: 4 }}>{playerFullName(player)}</div>
            <div style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3", marginTop: 3 }}>
              Age {player.Age} · Debut {span.startYear}
              {span.stillActive ? "" : ` — ${span.endYear}`} · {gamesPlayed} games · {statMeta.label.toLowerCase()}: {focusTotal}
            </div>
            <BigGameHonours player={player} />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <KpiTile value={player.OVR} label="OVR" />
              <KpiTile value={player.POT} label="Ceiling" tone="accent" />
              <KpiTile value={trajectory.peak.ovr} label={`Projected Peak · ${trajectory.peak.tier} (${trajectory.peak.year})`} tone="accent" />
            </div>
          </div>
        </HeroCard>

        <Card style={{ flex: "1 1 220px", minWidth: 0 }}>
          <SectionLabel>Focus Stat</SectionLabel>
          <div className="mt-2">
            <select
              value={statKey}
              onChange={(e) => setStatKey(e.target.value as LeagueStat)}
              style={{
                width: "100%",
                background: "rgba(0,0,0,.3)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 8,
                color: "#fff",
                font: "600 12px Barlow,sans-serif",
                padding: "8px 10px",
              }}
            >
              {ALL_LEAGUE_STATS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3" style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>
            Career total: <b style={{ color: "#fff" }}>{focusTotal}</b>
          </div>
        </Card>
      </div>

      <CareerArcChart player={player} trajectory={trajectory} />

      <div className="flex flex-wrap items-start gap-3">
        <AllTimeChase chases={chases} style={{ flex: "1 1 320px", minWidth: 0 }} />
        <Milestones milestones={milestones} style={{ flex: "1 1 260px", minWidth: 0 }} />
      </div>

      <SeasonBySeasonTable rows={yearRows} statKey={statKey} statLabel={statMeta.label} careerTotals={careerTotals} />
    </div>
  );
}

// --- Big-game honours (Big Game Splash) ----------------------------------------------------------

/** Medals (Norm Smith, Anzac Medal, Neale Daniher Trophy) and premierships won in this save, as gold chips under the name. */
function BigGameHonours({ player }: { player: Player }) {
  const chips = [
    ...(player.premiershipPlayer ?? []).map((y) => `${y} PREMIERSHIP PLAYER`),
    ...(player.honours ?? []).map((h) => `${h.medal} · ${h.season}${typeof h.round === "number" ? ` · R${h.round}` : ""}`),
    ...(player.grandFinalist ?? []).map((y) => `${y} GRAND FINALIST`),
  ];
  if (!chips.length) return null;
  return (
    <div data-testid="big-game-honours" className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <StatusChip key={c} color="#e8c25a">
          {c}
        </StatusChip>
      ))}
    </div>
  );
}

// --- Player selector -----------------------------------------------------------------------

function PlayerSelector({
  squad,
  selected,
  onSelect,
  pinnedIds,
  onTogglePin,
}: {
  squad: Player[];
  selected: Player;
  onSelect: (id: number) => void;
  pinnedIds: number[];
  onTogglePin: (id: number) => void;
}) {
  const sorted = [...squad].sort((a, b) => b.OVR - a.OVR);
  // Edge fades only on a side that actually has more chips to scroll to.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ left: false, right: false });
  function updateFades() {
    const el = scrollRef.current;
    if (!el) return;
    setFades({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }
  useEffect(updateFades, [squad.length]);
  return (
    // Round 126 — Cowork fix pass 1, item 6: the chip scroller hides its native scrollbar and fades
    // 24px into the card colour at each edge, so it reads as a themed strip rather than a white OS track.
    <Card padding="0" style={{ position: "relative", overflow: "hidden" }}>
      <div ref={scrollRef} onScroll={updateFades} className="scrollbar-none" style={{ overflowX: "auto", padding: "10px 14px" }}>
      <div className="flex items-center gap-2" style={{ minWidth: "max-content" }}>
        {sorted.map((p) => {
          const active = p.PlayerID === selected.PlayerID;
          const pinned = pinnedIds.includes(p.PlayerID);
          return (
            <button
              key={p.PlayerID}
              onClick={() => onSelect(p.PlayerID)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                border: 0,
                background: active ? "var(--acc)" : "rgba(255,255,255,.06)",
                color: active ? "var(--on)" : "#dfe5ee",
                font: "600 12px Barlow,sans-serif",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(p.PlayerID);
                }}
                style={{ color: active ? "var(--on)" : pinned ? "var(--accT)" : "#5d6880", cursor: "pointer" }}
              >
                {pinned ? "★" : "☆"}
              </span>
              #{p.jumperNumber} {playerFullName(p)}
              <span style={{ opacity: 0.7, font: "500 11px 'IBM Plex Mono',monospace" }}>{p.OVR}</span>
            </button>
          );
        })}
      </div>
      </div>
      <div aria-hidden style={{ opacity: fades.left ? 1 : 0, position: "absolute", top: 0, bottom: 0, left: 0, width: 24, pointerEvents: "none", background: "linear-gradient(90deg, color-mix(in oklch, var(--deep) var(--tc), #10151f), transparent)" }} />
      <div aria-hidden style={{ opacity: fades.right ? 1 : 0, position: "absolute", top: 0, bottom: 0, right: 0, width: 24, pointerEvents: "none", background: "linear-gradient(270deg, color-mix(in oklch, var(--deep) var(--tc), #10151f), transparent)" }} />
    </Card>
  );
}

// --- Career Arc chart ------------------------------------------------------------------------

function CareerArcChart({ player, trajectory }: { player: Player; trajectory: OvrTrajectory }) {
  const width = 640;
  const height = 200;
  const padL = 30;
  const padB = 22;
  const innerW = width - padL - 10;
  const innerH = height - padB - 10;
  const yMin = 25;
  const yMax = 100;
  const yToPx = (ovr: number) => 10 + innerH - ((ovr - yMin) / (yMax - yMin)) * innerH;
  const points = [{ x: 0, ovr: player.OVR, year: "Now" as string | number }, ...trajectory.years.map((y, i) => ({ x: i + 1, ovr: y.ovr, year: y.year }))];
  const xStep = innerW / (points.length - 1);
  const xToPx = (x: number) => padL + x * xStep;
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xToPx(p.x).toFixed(1)} ${yToPx(p.ovr).toFixed(1)}`).join(" ");
  const ceilingY = yToPx(player.POT);
  const peakIndex = points.findIndex((p) => p.year === trajectory.peak.year);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionLabel>Career Arc — OVR by Season</SectionLabel>
        <span style={{ font: "500 11px Barlow,sans-serif", color: "#8f9ab0" }}>
          Actual (today) · Projected (dashed) · Ceiling (POT)
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", marginTop: 8 }}>
        {/* grid */}
        {[30, 50, 70, 90].map((g) => (
          <line key={g} x1={padL} x2={width - 10} y1={yToPx(g)} y2={yToPx(g)} stroke="rgba(255,255,255,.06)" strokeWidth={1} />
        ))}
        <line x1={padL} x2={width - 10} y1={ceilingY} y2={ceilingY} stroke="var(--acc2)" strokeDasharray="2 3" strokeWidth={1.5} />
        <text x={width - 10} y={ceilingY - 4} textAnchor="end" fontSize={10} fill="var(--accT)" fontFamily="'IBM Plex Mono',monospace">
          CEILING {player.POT}
        </text>
        {/* projected dashed line (from Now through every projected year) */}
        <path d={pathD} fill="none" stroke="var(--acc)" strokeWidth={2} strokeDasharray="5 4" />
        {/* actual today point, solid & bold */}
        <circle cx={xToPx(0)} cy={yToPx(player.OVR)} r={4.5} fill="#fff" stroke="var(--acc)" strokeWidth={2} />
        {points.slice(1).map((p, i) => (
          <circle key={i} cx={xToPx(p.x)} cy={yToPx(p.ovr)} r={peakIndex === i + 1 ? 4.5 : 2.5} fill={peakIndex === i + 1 ? "var(--accT)" : "var(--acc)"} />
        ))}
        {points.map((p, i) =>
          i % 2 === 0 ? (
            <text key={i} x={xToPx(p.x)} y={height - 6} textAnchor="middle" fontSize={9} fill="#8f9ab0" fontFamily="'IBM Plex Mono',monospace">
              {p.year}
            </text>
          ) : null,
        )}
      </svg>
    </Card>
  );
}

// --- All-Time Chase --------------------------------------------------------------------------

function AllTimeChase({ chases, style }: { chases: ReturnType<typeof topRecordChasesFor>; style?: React.CSSProperties }) {
  return (
    <Card style={style}>
      <SectionLabel>All-Time Chase</SectionLabel>
      <div className="mt-2 flex flex-col gap-2.5">
        {chases.length === 0 && <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>Not yet inside any all-time top-100 leaderboard.</div>}
        {chases.map((c) => (
          <div key={c.category} style={{ padding: "10px 12px", borderRadius: 9, background: "rgba(0,0,0,.22)", border: "1px solid rgba(255,255,255,.06)" }}>
            <div className="flex items-center justify-between">
              <span style={{ font: "600 12px Barlow,sans-serif", color: "#dfe5ee" }}>{recordCategoryLabel(c.category)}</span>
              <StatusChip tone="accent">#{c.row.rank} now</StatusChip>
            </div>
            <div className="mt-1.5 flex items-center justify-between" style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>
              <span>
                {c.row.value} today → projected <b style={{ color: "#fff" }}>{c.projectedFinalValue}</b> (est. #{c.projectedFinalRank})
              </span>
              <span>
                {c.topName} leads on {c.topValue}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function recordCategoryLabel(category: string): string {
  const meta = ALL_LEAGUE_STATS.find((s) => s.key === category);
  if (meta) return meta.label;
  if (category === "gamesPlayed") return "Games Played";
  if (category === "finalsAppearances") return "Finals Appearances";
  return category;
}

// --- Milestones --------------------------------------------------------------------------------

interface Milestone {
  year: number;
  text: string;
}

function buildMilestones(yearRows: YearRow[], historyEntries: readonly { year: number; detail: string }[], draftEntries: readonly { year: number; draftType: string; pickNumber: number | null; club: string }[]): Milestone[] {
  const milestones: Milestone[] = [];
  for (const d of draftEntries) {
    milestones.push({ year: d.year, text: d.pickNumber !== null ? `${d.draftType} draft, pick #${d.pickNumber} — ${d.club}` : `${d.draftType} — ${d.club}` });
  }
  for (const h of historyEntries) milestones.push({ year: h.year, text: h.detail });

  const thresholds = [50, 100, 150, 200, 250, 300];
  let cumulative = 0;
  let thresholdIdx = 0;
  for (const row of [...yearRows].sort((a, b) => a.year - b.year)) {
    cumulative += row.totals.gamesPlayed;
    while (thresholdIdx < thresholds.length && cumulative >= thresholds[thresholdIdx]) {
      milestones.push({ year: row.year, text: `Reached ${thresholds[thresholdIdx]} career games.` });
      thresholdIdx++;
    }
  }
  return milestones.sort((a, b) => a.year - b.year);
}

function Milestones({ milestones, style }: { milestones: Milestone[]; style?: React.CSSProperties }) {
  return (
    <Card style={style}>
      <SectionLabel>Milestones</SectionLabel>
      <div className="mt-2 flex flex-col gap-2" style={{ maxHeight: 220, overflow: "auto" }}>
        {milestones.length === 0 && <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>No recorded milestones yet.</div>}
        {milestones.map((m, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 8, alignItems: "start" }}>
            <span style={{ font: "600 11px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>{m.year}</span>
            <span style={{ font: "500 12px/1.4 Barlow,sans-serif", color: "#dfe5ee" }}>{m.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- Season-by-Season table --------------------------------------------------------------------

function SeasonBySeasonTable({ rows, statKey, statLabel, careerTotals }: { rows: YearRow[]; statKey: LeagueStat; statLabel: string; careerTotals: ReturnType<typeof sumYearRows> }) {
  const sorted = [...rows].sort((a, b) => b.year - a.year);
  const maxPerGame = Math.max(0.01, ...sorted.map((r) => (r.totals.gamesPlayed > 0 ? r.totals[statKey] / r.totals.gamesPlayed : 0)));

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 10px" }}>
        <span style={{ font: "700 18px 'Barlow Condensed',sans-serif", color: "#fff" }}>Season by Season</span>
      </div>
      <div style={{ overflow: "auto" }}>
        <div style={{ minWidth: 620 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr 60px 90px 90px 70px",
              gap: 8,
              padding: "0 16px",
              height: 32,
              alignItems: "center",
              borderTop: "1px solid rgba(255,255,255,.07)",
              borderBottom: "1px solid rgba(255,255,255,.1)",
              font: "600 10px 'IBM Plex Mono',monospace",
              letterSpacing: ".7px",
              color: "#8f9ab0",
            }}
          >
            <span>YEAR</span>
            <span>TAG</span>
            <span style={{ textAlign: "center" }}>GMS</span>
            <span>{statLabel.toUpperCase()} / GM</span>
            <span style={{ textAlign: "right" }}>{statLabel.toUpperCase()}</span>
            <span style={{ textAlign: "right" }}>GRADE</span>
          </div>
          {sorted.map((r) => {
            const perGame = r.totals.gamesPlayed > 0 ? r.totals[statKey] / r.totals.gamesPlayed : 0;
            return (
              <div
                key={`${r.year}-${r.isReal ? "real" : "sim"}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr 60px 90px 90px 70px",
                  gap: 8,
                  padding: "0 16px",
                  height: 34,
                  alignItems: "center",
                  borderBottom: "1px solid rgba(255,255,255,.05)",
                  font: "500 12px Barlow,sans-serif",
                  color: "#dfe5ee",
                }}
              >
                <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff" }}>{r.year}</span>
                <span style={{ font: "500 11px Barlow,sans-serif", color: "#8f9ab0" }}>{r.isReal ? "AFL" : ""}{r.awardsTags && r.awardsTags.length > 0 ? " " + r.awardsTags.join(", ") : ""}</span>
                <span style={{ textAlign: "center", font: "600 12px 'IBM Plex Mono',monospace" }}>{r.totals.gamesPlayed}</span>
                <span style={{ position: "relative", height: 6, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden", alignSelf: "center" }}>
                  <span style={{ display: "block", height: "100%", width: `${(perGame / maxPerGame) * 100}%`, background: "var(--acc)" }} />
                </span>
                <span style={{ textAlign: "right", font: "600 12px 'IBM Plex Mono',monospace", color: "#fff" }}>{r.totals[statKey]}</span>
                <span style={{ textAlign: "right", font: "600 12px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>{r.grade ?? "—"}</span>
              </div>
            );
          })}
          {careerTotals && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr 60px 90px 90px 70px",
                gap: 8,
                padding: "0 16px",
                height: 36,
                alignItems: "center",
                background: "rgba(255,255,255,.03)",
                font: "700 12px Barlow,sans-serif",
                color: "#fff",
              }}
            >
              <span>CAREER</span>
              <span />
              <span style={{ textAlign: "center" }}>{careerTotals.gamesPlayed}</span>
              <span />
              <span style={{ textAlign: "right" }}>{careerTotals[statKey]}</span>
              <span />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
