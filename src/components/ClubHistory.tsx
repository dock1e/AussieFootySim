import { useMemo, type CSSProperties } from "react";
import { Card, HeroCard, KpiTile, SectionLabel, StatusChip, Watermark } from "./theme/primitives";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useCareerStore } from "../store/useCareerStore";
import { financeMilestones, historyOf, leagueStandingFor, moneyShort, tenureSummary, financialTarget } from "../engine/clubFinance";
import { defaultClubFinanceState, type ClubFinanceSeasonRecord } from "../types/clubFinance";
import { realFinancialsFor } from "../data/realClubFinancials";
import { CLUBS } from "../types/club";
import { MEANING_TOKENS } from "../theme/clubTokens";
import { CURRENT_SEASON_YEAR } from "../config";
import { FINANCE_LABEL, ON_FIELD_LABEL, confidenceLabel } from "../narrative/annualReport";
import { contractEndYear, tenureStartOf, RENEW_THRESHOLD, SACK_THRESHOLD, WARNING_THRESHOLD } from "../engine/boardReview";

/**
 * ROADMAP #14 — the career-progression "pride" view. Tyler's own framing: "as a player progresses
 * through their career they should be able to feel proud at growing financial success for their club
 * over time with their decisions and club success." Everything here reads `ClubFinanceState.history`
 * (real 2024/2025 rows from the club's own annual report, then one row per season played) — nothing is
 * stored just for display.
 */

const RISE = MEANING_TOKENS.rise;
const FALL = MEANING_TOKENS.fall;

function signed(n: number, fmt: (n: number) => string = moneyShort): string {
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

export function ClubHistory() {
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const coach = useCareerStore((s) => s.coach);
  const currentYear = useSaveStore((s) => s.year);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();
  const history = historyOf(state);
  const startYear = coach ? tenureStartOf(coach, CURRENT_SEASON_YEAR) : CURRENT_SEASON_YEAR;
  const tenure = tenureSummary(history, startYear);
  // The live member base already includes what the latest season earned (a season's own row holds the
  // tally it was played with), so "since you arrived" counts it.
  const membersNow = state.members ?? tenure.latest?.members;
  const membersChange = tenure.baseline?.members !== undefined && membersNow !== undefined ? membersNow - tenure.baseline.members : 0;
  const standing = leagueStandingFor(clubFinance, myClub);
  const milestones = useMemo(() => financeMilestones(history, myClub, clubFinance).reverse(), [history, myClub, clubFinance]);
  const latestBoard = [...history].reverse().find((h) => h.board)?.board;
  const real = realFinancialsFor(myClub);

  return (
    <div className="flex flex-col gap-5">
      <HeroCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Watermark>{tenure.seasons}</Watermark>
        <div style={{ position: "relative" }}>
          <SectionLabel>Since you arrived · {startYear}</SectionLabel>
          <div style={{ font: "700 26px/1.1 'Barlow Condensed',sans-serif", color: "#fff", marginTop: 3 }}>
            {tenure.seasons === 0 ? (
              <>Your first set of books closes at the end of the {currentYear} season.</>
            ) : (
              <>
                {tenure.seasons} season{tenure.seasons === 1 ? "" : "s"} in charge of <span style={{ color: "var(--accT)" }}>{myClub}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <KpiTile value={tenure.latest ? signed(tenure.revenueChange) : "—"} label="Revenue vs before you" color={tenure.revenueChange >= 0 ? RISE : FALL} />
          <KpiTile value={tenure.latest ? signed(membersChange, (n) => n.toLocaleString("en-AU")) : "—"} label="Members vs before you" color={membersChange >= 0 ? RISE : FALL} />
          <KpiTile value={tenure.latest ? signed(tenure.cumulativeResult) : "—"} label="Total operating result" color={tenure.cumulativeResult >= 0 ? RISE : FALL} />
          <KpiTile value={tenure.latest ? signed(tenure.netAssetsChange) : "—"} label="Net assets vs before you" color={tenure.netAssetsChange >= 0 ? RISE : FALL} />
        </div>
      </HeroCard>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12, alignItems: "start" }}>
        <Card padding="16px 18px" style={{ gridColumn: "1 / -1" }}>
          <SectionLabel style={{ marginBottom: 8 }}>Revenue & membership by season</SectionLabel>
          <HistoryChart history={history} startYear={startYear} />
        </Card>

        <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>Where {myClub} ranks in the AFL</SectionLabel>
          {standing ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <KpiTile value={ordinal(standing.revenueRank)} label="Revenue" tone="accent" />
              <KpiTile value={ordinal(standing.membersRank)} label="Membership" tone="accent" />
              <KpiTile value={ordinal(standing.resultRank)} label="Operating result" tone="accent" />
              <KpiTile value={ordinal(standing.netAssetsRank)} label="Net assets" tone="accent" />
            </div>
          ) : (
            <div style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3" }}>No completed season yet.</div>
          )}
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>Out of 18, on each club's most recent season.</div>
        </Card>

        <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>The board</SectionLabel>
          {latestBoard ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ font: "700 34px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>{latestBoard.confidence}</span>
                <span style={{ font: "600 14px Barlow,sans-serif", color: "var(--accT)" }}>{confidenceLabel(latestBoard.confidence)}</span>
                <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: latestBoard.delta >= 0 ? RISE : FALL }}>{signed(latestBoard.delta, String)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <StatusChip tone={latestBoard.onField === "missed" ? "bad" : "good"}>{ON_FIELD_LABEL[latestBoard.onField]}</StatusChip>
                <StatusChip tone={latestBoard.finance === "below" || latestBoard.finance === "heavyLoss" ? "bad" : "good"}>{FINANCE_LABEL[latestBoard.finance]}</StatusChip>
                {coach?.warnedYear !== undefined && <StatusChip tone="bad">Formal warning</StatusChip>}
              </div>
            </>
          ) : (
            <div style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3" }}>The board gives its first verdict when your first season's books close.</div>
          )}
          <div style={{ font: "500 12px/1.45 Barlow,sans-serif", color: "#8f9ab0" }}>
            Financial target: an operating result of at least {moneyShort(financialTarget(myClub))} a season
            {real.result < 0 ? " (halving the club's real 2025 loss)" : " (the club's real 2025 result)"}. Below {WARNING_THRESHOLD} confidence the board issues a formal warning;
            still below it a season later, or under {SACK_THRESHOLD} at any review, and you're sacked. When your contract
            {coach ? ` runs out after ${contractEndYear(coach, currentYear)}` : " runs out"}, the board renews it at {RENEW_THRESHOLD}+.
          </div>
        </Card>

        <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>Milestones</SectionLabel>
          {milestones.length === 0 ? (
            <div style={{ font: "500 13px/1.5 Barlow,sans-serif", color: "#aab3c3" }}>
              None yet. Record revenue, record membership, big surpluses and membership milestones will show up here as you set them.
            </div>
          ) : (
            milestones.slice(0, 12).map((m, i) => (
              <div key={`${m.year}-${m.kind}-${i}`} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "var(--accT)", flex: "none" }}>{m.year}</span>
                <span style={{ font: "500 14px Barlow,sans-serif", color: "#eef2f8" }}>{m.label}</span>
              </div>
            ))
          )}
        </Card>

        <LeagueCoachesCard myClub={myClub} coachName={coach?.name} />

        <Card padding="16px 18px" style={{ gridColumn: "1 / -1", overflowX: "auto" }}>
          <SectionLabel style={{ marginBottom: 8 }}>Season by season</SectionLabel>
          <HistoryTable history={history} startYear={startYear} />
          <div style={{ font: "500 12px/1.45 Barlow,sans-serif", color: "#8f9ab0", marginTop: 10 }}>
            {real.source === "report"
              ? `2024–25 figures are from ${myClub}'s real annual report, excluding one-off capital grants.`
              : `${myClub} doesn't publish a standalone annual report. Its 2025 figures are estimated from its real AFL distribution and real membership, using the other 16 clubs' median ratios.`}
          </div>
        </Card>
      </div>
    </div>
  );
}

const cell: CSSProperties = { padding: "7px 10px", font: "500 13px 'IBM Plex Mono',monospace", color: "#eef2f8", textAlign: "right", whiteSpace: "nowrap" };
const head: CSSProperties = { ...cell, font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: "1px", color: "#8f9ab0", textTransform: "uppercase" };

function HistoryTable({ history, startYear }: { history: readonly ClubFinanceSeasonRecord[]; startYear: number }) {
  const rows = [...history].reverse();
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <th style={{ ...head, textAlign: "left" }}>Season</th>
          <th style={head}>Finish</th>
          <th style={head}>Revenue</th>
          <th style={head}>Result</th>
          <th style={head}>Members</th>
          <th style={head}>Net assets</th>
          <th style={head}>Board</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.year} style={{ borderBottom: "1px solid rgba(255,255,255,.05)", background: r.year >= startYear ? "transparent" : "rgba(255,255,255,.02)" }}>
            <td style={{ ...cell, textAlign: "left" }}>
              {r.year} {r.source === "real" && <StatusChip>real</StatusChip>}
            </td>
            <td style={cell}>{r.ladderRank ? `${ordinal(r.ladderRank)}${r.premiers ? " · Premiers" : ""}` : "—"}</td>
            <td style={cell}>{moneyShort(r.revenue)}</td>
            <td style={{ ...cell, color: r.result >= 0 ? RISE : FALL }}>{signed(r.result)}</td>
            <td style={cell}>{r.members?.toLocaleString("en-AU") ?? "—"}</td>
            <td style={cell}>{r.netAssets !== undefined ? moneyShort(r.netAssets) : "—"}</td>
            <td style={cell}>{r.board ? `${r.board.confidence} (${signed(r.board.delta, String)})` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Revenue bars (sim seasons in club colour, real seasons ghosted) with a membership line on its own scale. */
function HistoryChart({ history, startYear }: { history: readonly ClubFinanceSeasonRecord[]; startYear: number }) {
  const W = 720;
  const H = 220;
  const padL = 52;
  const padR = 60;
  const padT = 14;
  const padB = 28;
  if (history.length === 0) return null;
  const maxRev = Math.max(...history.map((h) => h.revenue)) * 1.1;
  const memberRows = history.filter((h) => h.members !== undefined);
  const memVals = memberRows.map((h) => h.members!);
  const minMem = Math.min(...memVals) * 0.9;
  const maxMem = Math.max(...memVals) * 1.05;
  const n = history.length;
  const slot = (W - padL - padR) / n;
  const barW = Math.min(46, slot * 0.6);
  const x = (i: number) => padL + slot * i + slot / 2;
  const yRev = (v: number) => padT + (H - padT - padB) * (1 - v / maxRev);
  const yMem = (v: number) => padT + (H - padT - padB) * (1 - (v - minMem) / Math.max(1, maxMem - minMem));
  const linePts = history.map((h, i) => (h.members !== undefined ? `${x(i)},${yMem(h.members)}` : null)).filter(Boolean).join(" ");
  const ticks = [0, 0.5, 1].map((t) => t * maxRev);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Revenue and membership by season">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yRev(t)} y2={yRev(t)} stroke="rgba(255,255,255,.07)" />
            <text x={padL - 6} y={yRev(t) + 4} textAnchor="end" fill="#8f9ab0" fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {moneyShort(t)}
            </text>
          </g>
        ))}
        {history.map((h, i) => (
          <g key={h.year}>
            <rect x={x(i) - barW / 2} y={yRev(h.revenue)} width={barW} height={H - padB - yRev(h.revenue)} rx={3} fill={h.year >= startYear ? "var(--acc)" : "rgba(255,255,255,.18)"}>
              <title>{`${h.year}: revenue ${moneyShort(h.revenue)}, result ${moneyShort(h.result)}${h.members ? `, ${h.members.toLocaleString("en-AU")} members` : ""}`}</title>
            </rect>
            <text x={x(i)} y={H - 10} textAnchor="middle" fill="#aab3c3" fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {n > 12 ? `'${String(h.year).slice(2)}` : h.year}
            </text>
          </g>
        ))}
        {memberRows.length > 1 && <polyline points={linePts} fill="none" stroke={RISE} strokeWidth={2} />}
        {history.map((h, i) =>
          h.members !== undefined ? <circle key={`m${h.year}`} cx={x(i)} cy={yMem(h.members)} r={3} fill={RISE} /> : null,
        )}
        {memVals.length > 0 && (
          <>
            <text x={W - padR + 6} y={yMem(maxMem) + 10} fill={RISE} fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {Math.round(maxMem / 1000)}k
            </text>
            <text x={W - padR + 6} y={yMem(minMem)} fill={RISE} fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {Math.round(minMem / 1000)}k
            </text>
          </>
        )}
      </svg>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", font: "500 12px Barlow,sans-serif", color: "#aab3c3", marginTop: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--acc)", marginRight: 6 }} />Revenue, your seasons</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "rgba(255,255,255,.18)", marginRight: 6 }} />Revenue, before you</span>
        <span><span style={{ display: "inline-block", width: 14, height: 2, background: RISE, marginRight: 6, verticalAlign: "middle" }} />Members (right scale)</span>
      </div>
    </div>
  );
}

/**
 * ROADMAP #14 follow-up — who's coaching every club, how long they've been there, their record in this
 * save, and whether their board has them on notice. Board confidence itself stays private (a real club
 * doesn't publish it); a formal warning or a final contract year is the kind of thing that leaks.
 */
function LeagueCoachesCard({ myClub, coachName }: { myClub: string; coachName: string | undefined }) {
  const seniorCoaches = useSaveStore((s) => s.seniorCoaches);
  const year = useSaveStore((s) => s.year);
  if (!seniorCoaches) return null;
  const rows = CLUBS.map((c) => ({ club: c.name, coach: c.name === myClub ? undefined : seniorCoaches.clubs[c.name] }));
  return (
    <Card padding="16px 18px" style={{ gridColumn: "1 / -1", overflowX: "auto" }}>
      <SectionLabel style={{ marginBottom: 8 }}>Senior coaches around the AFL</SectionLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,.1)" }}>
            <th style={{ ...head, textAlign: "left" }}>Club</th>
            <th style={{ ...head, textAlign: "left" }}>Coach</th>
            <th style={head}>Since</th>
            <th style={head}>Record (this save)</th>
            <th style={head}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ club, coach }) => (
            <tr key={club} style={{ borderBottom: "1px solid rgba(255,255,255,.05)", background: club === myClub ? "color-mix(in oklch, var(--acc) 10%, transparent)" : "transparent" }}>
              <td style={{ ...cell, textAlign: "left", fontFamily: "Barlow,sans-serif" }}>{club}</td>
              <td style={{ ...cell, textAlign: "left", fontFamily: "Barlow,sans-serif" }} title={coach?.note}>
                {club === myClub ? `${coachName ?? "You"} (you)` : coach ? coach.name : "Vacant"}
              </td>
              <td style={cell}>{coach?.sinceYear ?? "—"}</td>
              <td style={cell}>{coach ? `${coach.wins}-${coach.draws}-${coach.losses}${coach.premierships ? ` · ${coach.premierships} flag${coach.premierships > 1 ? "s" : ""}` : ""}` : "—"}</td>
              <td style={cell}>
                {coach?.warnedYear !== undefined ? <StatusChip tone="bad">On notice</StatusChip> : coach && coach.contractEndYear <= year ? <StatusChip tone="warn">Final year</StatusChip> : coach === null ? <StatusChip tone="warn">Vacant</StatusChip> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {seniorCoaches.freeAgents.length > 0 && (
        <div style={{ font: "500 12px/1.45 Barlow,sans-serif", color: "#8f9ab0", marginTop: 10 }}>
          Out of work: {seniorCoaches.freeAgents.map((f) => `${f.coach.name} (ex-${f.lastClub})`).join(", ")}.
        </div>
      )}
    </Card>
  );
}