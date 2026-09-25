import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Player } from "../../types/player";
import { playerFullName } from "../../types/player";
import type { Position } from "../../types/archetype";
import type { MatchTeam } from "../../engine/team";
import { onGroundPlayers, benchPlayers } from "../../engine/team";
import type { BoxScoreLine, MatchEvent } from "../../engine/match";
import type { Side } from "../../engine/zones";
import { curveGeometryFor, type CurveGeometry, type PlayerMatchFantasyMetrics } from "../../engine/fantasyEngine";
import { FANTASY_POINT_WEIGHTS } from "../../engine/ratings";
import { BARLOW, CARD_BG, CARD_BORDER, FALL, MONO, RISE, WARN, FitnessValue, TeamChip, clubAbbr, eventClock, sectionLabelStyle } from "./shared";

/**
 * Match Day v2 — live-screen widgets (`02-implementation-spec.md` §1.1, §1.3–1.5). Each takes engine
 * values (box score, `computeFantasyMetrics`, the revealed event log) and renders the reference's
 * view-model shapes; nothing here invents a number.
 */

export type SelectFn = (player: Player, side: Side) => void;

/**
 * A pre-season fantasy average from the player's real 2025 season (`stat_*` totals), using the same
 * `FANTASY_POINT_WEIGHTS` the engine scores with. Used only when no in-save season average exists yet —
 * without it, `paceDelta = fp − 0 × elapsed` just equals FP (critique B1).
 */
export function baselineFpAverage(p: Player): number {
  if (!p.stat_GM) return 0;
  const w = FANTASY_POINT_WEIGHTS;
  const total = (w.kicks ?? 0) * p.stat_KI + (w.handballs ?? 0) * p.stat_HB + (w.marks ?? 0) * p.stat_MK + (w.tackles ?? 0) * p.stat_TK + (w.goals ?? 0) * p.stat_GL + (w.hitouts ?? 0) * p.stat_HO;
  return total / p.stat_GM;
}

const MIRROR: Partial<Record<Position, Position>> = {
  FB: "FF",
  FF: "FB",
  BP: "FP",
  FP: "BP",
  CHB: "CHF",
  CHF: "CHB",
  HBF: "HFF",
  HFF: "HBF",
  C: "C",
  W: "W",
  R: "R",
  RR: "RR",
  ROV: "ROV",
};

/**
 * Critique B9: each of their on-ground players' direct opponent on our side — the mirrored position
 * (their FF ↔ our FB, their HFF ↔ our HBF…), pairing duplicate slots (two BPs, two Ws) in lineup order.
 */
export function directOpponents(theirs: MatchTeam, ours: MatchTeam): Map<number, Player> {
  const out = new Map<number, Player>();
  if (!theirs.positions || !ours.positions) return out;
  const ourByPos = new Map<Position, Player[]>();
  for (const p of onGroundPlayers(ours)) {
    const pos = ours.positions.get(p.PlayerID);
    if (!pos) continue;
    if (!ourByPos.has(pos)) ourByPos.set(pos, []);
    ourByPos.get(pos)!.push(p);
  }
  const used = new Map<Position, number>();
  for (const p of onGroundPlayers(theirs)) {
    const pos = theirs.positions.get(p.PlayerID);
    const mirror = pos ? MIRROR[pos] : undefined;
    if (!mirror) continue;
    const list = ourByPos.get(mirror) ?? [];
    const i = used.get(mirror) ?? 0;
    used.set(mirror, i + 1);
    const match = list[i] ?? list[0];
    if (match) out.set(p.PlayerID, match);
  }
  return out;
}

// --- 1.1 Live board --------------------------------------------------------------------------------

type ColumnSetName = "fantasy" | "disposal" | "contest" | "role";

interface BoardRow {
  player: Player;
  line: BoxScoreLine | undefined;
  m: PlayerMatchFantasyMetrics | undefined;
  fitness: number;
  isBench: boolean;
}

interface BoardColumn {
  key: string;
  label: string;
  title: string;
  width: number;
  value: (r: BoardRow) => number;
  format?: (v: number) => string;
  /** Hidden on narrow boards (spec §4: FP/M and TOG). */
  narrowHide?: boolean;
  style?: (r: BoardRow) => CSSProperties;
}

const num = (v: number) => Math.round(v).toString();

const BOARD_COLUMN_SETS: Record<ColumnSetName, BoardColumn[]> = {
  fantasy: [
    { key: "fp", label: "FP", title: "Live fantasy points", width: 38, value: (r) => r.m?.fp ?? 0, format: num, style: () => ({ font: `600 13px ${MONO}`, color: "#fff" }) },
    {
      key: "delta5",
      label: "Δ5",
      title: "Fantasy points in the last 5 minutes",
      width: 38,
      value: (r) => r.m?.delta5 ?? 0,
      format: (v) => (v > 0 ? `+${Math.round(v)}` : Math.round(v).toString()),
      style: (r) => ({ font: `600 12px ${MONO}`, color: (r.m?.delta5 ?? 0) > 0 ? RISE : "#5d6880" }),
    },
    { key: "fpPerMin", label: "FP/M", title: "Fantasy points per minute on ground", width: 46, value: (r) => r.m?.fpPerMin ?? 0, format: (v) => v.toFixed(2), narrowHide: true },
    { key: "proj", label: "PROJ", title: "Projected final fantasy points", width: 44, value: (r) => r.m?.proj ?? 0, format: num },
    {
      key: "tog",
      label: "TOG",
      title: "Time on ground",
      width: 44,
      value: (r) => r.m?.tog ?? 0,
      format: (v) => `${Math.round(v)}%`,
      narrowHide: true,
      style: (r) => ({ color: (r.m?.tog ?? 100) < 50 ? WARN : "#c3ccdd" }),
    },
  ],
  disposal: [
    { key: "disposals", label: "D", title: "Disposals", width: 38, value: (r) => r.line?.disposals ?? 0, style: () => ({ font: `600 13px ${MONO}`, color: "#fff" }) },
    { key: "kicks", label: "K", title: "Kicks", width: 38, value: (r) => r.line?.kicks ?? 0 },
    { key: "handballs", label: "HB", title: "Handballs", width: 38, value: (r) => r.line?.handballs ?? 0 },
    { key: "marks", label: "M", title: "Marks", width: 38, value: (r) => r.line?.marks ?? 0 },
    { key: "contestedPoss", label: "CP", title: "Contested possessions", width: 38, value: (r) => r.line?.contestedPoss ?? 0, narrowHide: true },
    {
      key: "efficiency",
      label: "EFF",
      title: "Disposal efficiency — (disposals minus turnovers) / disposals",
      width: 44,
      value: (r) => (r.line && r.line.disposals > 0 ? ((r.line.disposals - r.line.turnovers) / r.line.disposals) * 100 : 0),
      format: (v) => `${Math.round(v)}%`,
      narrowHide: true,
    },
  ],
  contest: [
    { key: "tackles", label: "T", title: "Tackles", width: 38, value: (r) => r.line?.tackles ?? 0, style: () => ({ font: `600 13px ${MONO}`, color: "#fff" }) },
    { key: "clearances", label: "CLR", title: "Clearances", width: 40, value: (r) => r.line?.clearances ?? 0 },
    { key: "hitouts", label: "HO", title: "Hitouts", width: 38, value: (r) => r.line?.hitouts ?? 0 },
    { key: "groundBallWins", label: "HBG", title: "Hard ball gets", width: 40, value: (r) => r.line?.groundBallWins ?? 0, narrowHide: true },
    { key: "spoils", label: "1%", title: "One-percenters (spoils)", width: 38, value: (r) => r.line?.spoils ?? 0, narrowHide: true },
  ],
  role: [
    { key: "cba", label: "CBA", title: "Centre bounce attendance", width: 44, value: (r) => r.m?.cba ?? 0, format: (v) => `${Math.round(v)}%` },
    { key: "kickIns", label: "KI", title: "Kick-ins taken", width: 38, value: (r) => r.m?.kickIns ?? 0 },
    {
      key: "tog",
      label: "TOG",
      title: "Time on ground",
      width: 44,
      value: (r) => r.m?.tog ?? 0,
      format: (v) => `${Math.round(v)}%`,
      narrowHide: true,
      style: (r) => ({ color: (r.m?.tog ?? 100) < 50 ? WARN : "#c3ccdd" }),
    },
    { key: "longestStint", label: "STINT", title: "Longest unbroken stint on ground", width: 46, value: (r) => r.m?.longestStintMinutes ?? 0, format: (v) => `${Math.round(v)}m`, narrowHide: true },
    { key: "fitness", label: "FIT", title: "In-match fitness", width: 44, value: (r) => r.fitness, format: (v) => `${Math.round(v)}%` },
  ],
};

const COLUMN_SETS: ColumnSetName[] = ["fantasy", "disposal", "contest", "role"];

function templateFor(columns: BoardColumn[], narrow: boolean): string {
  return ["38px", "minmax(0,1fr)", ...columns.filter((c) => !(narrow && c.narrowHide)).map((c) => `${c.width}px`)].join(" ");
}

/** Board width at which FP/M and TOG drop and rows grow to 44px touch targets (spec §4 / critique B10). */
function useNarrow(ref: React.RefObject<HTMLElement>, threshold = 420): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < threshold || window.innerWidth < 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, threshold]);
  return narrow;
}

export function LiveBoard({
  team,
  side,
  liveBoxScore,
  fantasyMetrics,
  fitnessOf,
  selectedPlayerId,
  hoveredPlayerId,
  onHoverPlayer,
  onSelect,
}: {
  team: MatchTeam;
  side: Side;
  liveBoxScore: Record<number, BoxScoreLine>;
  fantasyMetrics: Map<number, PlayerMatchFantasyMetrics>;
  fitnessOf: (side: Side, playerId: number) => number;
  selectedPlayerId: number | null;
  hoveredPlayerId: number | null;
  onHoverPlayer: (id: number | null) => void;
  onSelect: SelectFn;
}) {
  const [columnSet, setColumnSet] = useState<ColumnSetName>("fantasy");
  const [sort, setSort] = useState<{ column: string; direction: 1 | -1 }>({ column: "fp", direction: -1 });
  const ref = useRef<HTMLElement>(null);
  const narrow = useNarrow(ref);

  const columns = BOARD_COLUMN_SETS[columnSet];
  const visible = columns.filter((c) => !(narrow && c.narrowHide));
  const template = templateFor(columns, narrow);
  const sortCol = columns.find((c) => c.key === sort.column) ?? columns[0];

  const rowFor = (player: Player, isBench: boolean): BoardRow => ({ player, line: liveBoxScore[player.PlayerID], m: fantasyMetrics.get(player.PlayerID), fitness: fitnessOf(side, player.PlayerID), isBench });
  const byCol = (a: BoardRow, b: BoardRow) => (sortCol.value(a) - sortCol.value(b)) * sort.direction;
  const onGround = onGroundPlayers(team).map((p) => rowFor(p, false)).sort(byCol);
  const bench = benchPlayers(team).map((p) => rowFor(p, true)).sort(byCol);

  const rowHeight = narrow ? 44 : 28;

  function renderRow(r: BoardRow) {
    const on = r.player.PlayerID === selectedPlayerId;
    const hover = r.player.PlayerID === hoveredPlayerId;
    return (
      <div
        key={r.player.PlayerID}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(r.player, side)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(r.player, side);
          }
        }}
        onMouseEnter={() => onHoverPlayer(r.player.PlayerID)}
        onMouseLeave={() => onHoverPlayer(null)}
        title={playerFullName(r.player)}
        style={{
          display: "grid",
          gridTemplateColumns: template,
          gap: 6,
          alignItems: "center",
          padding: "0 10px",
          height: rowHeight,
          cursor: "pointer",
          borderRadius: 6,
          background: on ? "color-mix(in oklch, var(--acc) 20%, transparent)" : hover ? "rgba(255,255,255,.04)" : "transparent",
          boxShadow: on ? "inset 3px 0 0 var(--acc)" : "none",
          opacity: r.isBench ? 0.75 : 1,
        }}
      >
        <span style={{ font: `500 10px ${MONO}`, color: r.isBench ? "#8f9ab0" : "var(--accT)" }}>{team.positions?.get(r.player.PlayerID) ?? "—"}</span>
        <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.player.lname}</span>
        {visible.map((c) => {
          const v = c.value(r);
          return (
            <span key={c.key} style={{ textAlign: "right", font: `400 12px ${MONO}`, color: "#c3ccdd", fontVariantNumeric: "tabular-nums", ...c.style?.(r) }}>
              {c.format ? c.format(v) : Math.round(v)}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <section
      ref={ref}
      className="md-live-board"
      style={{ flex: "1 1 380px", maxWidth: "100%", minWidth: 0, background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: "10px 4px 8px", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 10px 8px", gap: 8, flexWrap: "wrap" }}>
        <div style={sectionLabelStyle()}>{team.name} · LIVE BOARD</div>
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 7, background: "rgba(0,0,0,.25)" }}>
          {COLUMN_SETS.map((k) => {
            const on = k === columnSet;
            return (
              <button
                key={k}
                onClick={() => {
                  setColumnSet(k);
                  setSort({ column: BOARD_COLUMN_SETS[k][0].key, direction: -1 });
                }}
                style={{ border: 0, cursor: "pointer", borderRadius: 5, padding: "4px 8px", background: on ? "var(--acc)" : "transparent", color: on ? "var(--on)" : "#aab3c3", font: `600 10px ${MONO}`, letterSpacing: ".7px" }}
              >
                {k.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: template,
          gap: 6,
          padding: "0 10px",
          height: 26,
          alignItems: "center",
          font: `600 9px ${MONO}`,
          letterSpacing: ".7px",
          color: "#8f9ab0",
          borderBottom: "1px solid rgba(255,255,255,.08)",
          flex: "none",
        }}
      >
        <span>POS</span>
        <span>PLAYER</span>
        {visible.map((c) => {
          const on = c.key === sort.column;
          return (
            <button
              key={c.key}
              title={`${c.title} — click to sort`}
              onClick={() => setSort((prev) => (prev.column === c.key ? { column: c.key, direction: (-prev.direction) as 1 | -1 } : { column: c.key, direction: -1 }))}
              style={{ textAlign: "right", background: "none", border: 0, padding: 0, cursor: "pointer", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: on ? "var(--accT)" : "#8f9ab0", whiteSpace: "nowrap" }}
            >
              {c.label}
              {on ? (sort.direction < 0 ? " ▾" : " ▴") : ""}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {onGround.map(renderRow)}
        {bench.length > 0 && (
          <div style={{ margin: "6px 10px 2px", paddingTop: 6, borderTop: "1px solid rgba(255,255,255,.07)", font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>INTERCHANGE</div>
        )}
        {bench.map(renderRow)}
      </div>
    </section>
  );
}

// --- 1.3 Your movers -------------------------------------------------------------------------------

const WIDGET: CSSProperties = { background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: "12px 16px", height: 320, overflow: "hidden" };

function Sparkline({ geometry }: { geometry: CurveGeometry }) {
  const pts = geometry.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const lit = geometry.recentPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 130 20" style={{ width: 100, height: 20, overflow: "visible", display: "block" }} aria-hidden="true">
      {pts && <polyline points={pts} style={{ fill: "none", stroke: "color-mix(in oklch, var(--acc2) 70%, #10151f)", strokeWidth: 1.4 }} />}
      {lit && <polyline points={lit} style={{ fill: "none", stroke: "var(--accT)", strokeWidth: 2, strokeLinecap: "round" }} />}
      {geometry.points
        .filter((p) => p.isGoal)
        .map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.4} style={{ fill: WARN }} />
        ))}
    </svg>
  );
}

/**
 * Critiques B1–B3: only players who actually moved (Δ5 > 0), top 5, no padding rows; pace is FP against
 * his average for the minutes played so far (`paceDelta`), never FP itself.
 */
export function MoversWidget({
  team,
  side,
  events,
  ticksPerQuarter,
  fantasyMetrics,
  onSelect,
}: {
  team: MatchTeam;
  side: Side;
  events: MatchEvent[];
  ticksPerQuarter: number;
  fantasyMetrics: Map<number, PlayerMatchFantasyMetrics>;
  onSelect: SelectFn;
}) {
  const grid = "18px minmax(0,1fr) 100px 40px 38px";
  const rows = team.players
    .map((player) => ({ player, m: fantasyMetrics.get(player.PlayerID) }))
    .filter((r): r is { player: Player; m: PlayerMatchFantasyMetrics } => !!r.m && r.m.delta5 > 0)
    .sort((a, b) => b.m.delta5 - a.m.delta5 || b.m.fp - a.m.fp)
    .slice(0, 5);
  return (
    <section data-screen-label="Movers" style={WIDGET}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 22 }}>
        <span style={sectionLabelStyle(true)}>YOUR MOVERS · LAST 5 MIN</span>
        <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0" }}>Δ5 &gt; 0 ONLY</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, height: 22, alignItems: "center", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <span>#</span>
        <span>PLAYER · WHAT CHANGED</span>
        <span>FP CURVE</span>
        <span style={{ textAlign: "right" }}>Δ5</span>
        <span style={{ textAlign: "right" }}>PROJ</span>
      </div>
      {rows.length === 0 && (
        <div style={{ padding: "18px 0", font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>
          {events.length === 0 ? "Movers appear once the ball is bounced." : "Nobody on your list has scored in the last 5 minutes."}
        </div>
      )}
      {rows.map(({ player, m }, i) => {
        const pace = m.paceDelta;
        const paceColor = pace > 0 ? RISE : pace <= -5 ? FALL : "#8f9ab0";
        return (
          <div
            key={player.PlayerID}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(player, side)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(player, side)}
            style={{ display: "grid", gridTemplateColumns: grid, gap: 10, height: 48, alignItems: "center", borderBottom: "1px solid rgba(255,255,255,.04)", cursor: "pointer" }}
          >
            <span style={{ font: `500 11px ${MONO}`, color: "#8f9ab0" }}>{i + 1}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
                <span style={{ flex: "none", font: `600 14px ${BARLOW}`, color: "#fff", whiteSpace: "nowrap" }}>{player.lname}</span>
                <span style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", font: `500 10px ${MONO}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>
                  {team.positions?.get(player.PlayerID) ?? ""} · {Math.round(m.fp)} FP
                </span>
                <span style={{ flex: "none", font: `500 10px ${MONO}`, color: paceColor, whiteSpace: "nowrap" }} title="Fantasy points against his average for the minutes played so far">
                  {pace > 0 ? "+" : ""}
                  {pace} vs avg
                </span>
              </span>
              <span style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.whatChanged || "—"}</span>
            </span>
            <Sparkline geometry={curveGeometryFor(events, player.PlayerID, ticksPerQuarter)} />
            <span style={{ textAlign: "right", font: `600 14px ${MONO}`, color: RISE }}>+{Math.round(m.delta5)}</span>
            <span style={{ textAlign: "right", font: `500 13px ${MONO}`, color: "#fff" }}>{Math.round(m.proj)}</span>
          </div>
        );
      })}
    </section>
  );
}

// --- 1.4 Play by play ------------------------------------------------------------------------------

type PbpFilter = "all" | "scores" | "mine";

interface PlayRow {
  index: number;
  clock: string;
  teamName: string;
  text: string;
  kind: "goal" | "behind" | "play";
  score?: string;
  mine: boolean;
}

/** Critique B8: clock, team chip and text per row; goals bold with a gold running score; filter chips. */
export function PlayByPlayWidget({
  events,
  ticksPerQuarter,
  homeTeam,
  awayTeam,
  homeIds,
  yourSide,
}: {
  events: MatchEvent[];
  ticksPerQuarter: number;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  homeIds: Set<number>;
  yourSide: Side;
}) {
  const [filter, setFilter] = useState<PbpFilter>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const homeAbbr = clubAbbr(homeTeam.name);
  const awayAbbr = clubAbbr(awayTeam.name);
  const yourTeam = yourSide === "home" ? homeTeam : awayTeam;

  const rows = useMemo(() => {
    let hp = 0;
    let ap = 0;
    const out: PlayRow[] = [];
    events.forEach((ev, index) => {
      let kind: PlayRow["kind"] = "play";
      let scorerSide: Side | null = null;
      for (const d of ev.statDeltas) {
        if (d.stat === "goals" || d.stat === "behinds") {
          const isHome = homeIds.has(d.playerId);
          const pts = d.stat === "goals" ? 6 : 1;
          if (isHome) hp += pts * d.delta;
          else ap += pts * d.delta;
          scorerSide = isHome ? "home" : "away";
          if (d.stat === "goals") kind = "goal";
          else if (kind !== "goal") kind = "behind";
        }
      }
      const side: Side = scorerSide ?? ev.possession;
      const prefix = kind === "goal" ? "GOAL · " : kind === "behind" ? "BEHIND · " : "";
      out.push({
        index,
        clock: `${eventClock(ev, ticksPerQuarter)}`,
        teamName: side === "home" ? homeTeam.name : awayTeam.name,
        text: prefix + ev.description,
        kind,
        score: kind === "play" ? undefined : `${homeAbbr} ${hp} · ${ap} ${awayAbbr}`,
        mine: side === yourSide,
      });
    });
    return out.reverse();
  }, [events, ticksPerQuarter, homeTeam, awayTeam, homeIds, yourSide, homeAbbr, awayAbbr]);

  const shown = rows.filter((r) => filter === "all" || (filter === "scores" && r.kind !== "play") || (filter === "mine" && r.mine)).slice(0, 80);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [events.length]);

  const chip = (on: boolean): CSSProperties => ({
    border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.12)"}`,
    borderRadius: 999,
    padding: "3px 9px",
    background: on ? "color-mix(in oklch, var(--acc) 18%, transparent)" : "transparent",
    color: on ? "#fff" : "#aab3c3",
    font: `600 11px ${BARLOW}`,
    cursor: "pointer",
  });

  return (
    <section data-screen-label="Play by play" style={{ ...WIDGET, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: 22, marginBottom: 6 }}>
        <span style={sectionLabelStyle()}>PLAY BY PLAY</span>
        <div style={{ display: "flex", gap: 4 }}>
          {(
            [
              ["all", "All"],
              ["scores", "Scores"],
              ["mine", clubAbbr(yourTeam.name)],
            ] as [PbpFilter, string][]
          ).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={chip(filter === k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {shown.length === 0 && <div style={{ padding: "12px 0", font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>{events.length === 0 ? "First bounce coming up…" : "Nothing here yet."}</div>}
        {shown.map((r) => {
          const scoring = r.kind !== "play";
          return (
            <div key={r.index} style={{ display: "grid", gridTemplateColumns: "64px 44px minmax(0,1fr)", gap: 8, alignItems: "start", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
              <span style={{ font: `500 11px ${MONO}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>{r.clock}</span>
              <TeamChip name={r.teamName} size={10} />
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ font: `${r.kind === "goal" ? 700 : 500} 14px/1.35 ${BARLOW}`, color: r.kind === "goal" ? "#fff" : "#c3ccdd" }}>{r.text}</span>
                {scoring && <span style={{ font: `600 11px ${MONO}`, color: WARN }}>{r.score}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- 1.5 Their danger men --------------------------------------------------------------------------

export function DangerMenWidget({
  theirTeam,
  ourTeam,
  ourSide,
  fantasyMetrics,
  fitnessOf,
  onSelect,
  tags,
}: {
  theirTeam: MatchTeam;
  ourTeam: MatchTeam;
  ourSide: Side;
  fantasyMetrics: Map<number, PlayerMatchFantasyMetrics>;
  fitnessOf: (side: Side, playerId: number) => number;
  onSelect: SelectFn;
  /** Match Day flow (round 128): this week's tags, their PlayerID → your tagger's. A tagged man always shows, matched by his tagger. */
  tags?: Map<number, number>;
}) {
  const grid = "36px minmax(0,1fr) 40px minmax(0,1fr)";
  const opponents = directOpponents(theirTeam, ourTeam);
  const ourById = new Map(ourTeam.players.map((p) => [p.PlayerID, p]));
  const byFp = onGroundPlayers(theirTeam)
    .map((player) => ({ player, fp: fantasyMetrics.get(player.PlayerID)?.fp ?? 0 }))
    .sort((a, b) => b.fp - a.fp);
  const tagged = theirTeam.players.filter((p) => tags?.has(p.PlayerID)).map((player) => ({ player, fp: fantasyMetrics.get(player.PlayerID)?.fp ?? 0 }));
  const rows = [...tagged, ...byFp.filter((r) => !tags?.has(r.player.PlayerID))].slice(0, 4);
  return (
    <section data-screen-label="Danger men" style={WIDGET}>
      <div style={{ ...sectionLabelStyle(), height: 22, display: "flex", alignItems: "center", marginBottom: 6 }}>{theirTeam.name} · THEIR DANGER MEN</div>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, height: 22, alignItems: "center", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <span>POS</span>
        <span>PLAYER</span>
        <span style={{ textAlign: "right" }}>FP</span>
        <span>MATCHED BY</span>
      </div>
      {rows.map(({ player, fp }) => {
        const taggerId = tags?.get(player.PlayerID);
        const tagger = taggerId !== undefined ? ourById.get(taggerId) : undefined;
        const by = tagger ?? opponents.get(player.PlayerID);
        // Tag watch: is the tagged man running under or over his own average so far (the same pace
        // number the board uses)? Not called until his average says he'd have 10 points by now.
        const m = fantasyMetrics.get(player.PlayerID);
        const verdict = tagger && m && m.fp - m.paceDelta >= 10 ? (m.paceDelta <= 0 ? { text: "HOLDING", color: RISE } : { text: "LOSING HIM", color: FALL }) : null;
        return (
          <div key={player.PlayerID} style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center", height: 56, borderBottom: "1px solid rgba(255,255,255,.04)" }}>
            <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0" }}>{theirTeam.positions?.get(player.PlayerID) ?? "—"}</span>
            <span style={{ font: `600 15px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{playerFullName(player)}</span>
            <span style={{ textAlign: "right", font: `600 15px ${MONO}`, color: "#fff" }}>{Math.round(fp)}</span>
            {by ? (
              <button
                onClick={() => onSelect(by, ourSide)}
                title={`Find ${playerFullName(by)} on the ground`}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", minWidth: 0, textAlign: "left" }}
              >
                {tagger && <span style={{ flex: "none", font: `600 9px ${MONO}`, letterSpacing: ".8px", color: WARN, padding: "1px 4px", border: `1px solid ${WARN}`, borderRadius: 4 }}>TAG</span>}
                <span style={{ font: `600 13px ${BARLOW}`, color: "var(--accT)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  #{by.jumperNumber} {by.lname}
                </span>
                {verdict ? (
                  <span style={{ flex: "none", font: `600 9px ${MONO}`, letterSpacing: ".6px", color: verdict.color }} title="His fantasy points against his own average so far">
                    {verdict.text}
                  </span>
                ) : (
                  <FitnessValue value={fitnessOf(ourSide, by.PlayerID)} boxed />
                )}
              </button>
            ) : (
              <span style={{ font: `500 12px ${BARLOW}`, color: "#5d6880" }}>—</span>
            )}
          </div>
        );
      })}
    </section>
  );
}
