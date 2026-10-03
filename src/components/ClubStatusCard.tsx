import { useMemo } from "react";
import { Card, StatusChip } from "./theme/primitives";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useCareerStore } from "../store/useCareerStore";
import { financeMilestones, historyOf, moneyShort } from "../engine/clubFinance";
import { contractEndYear, RENEW_THRESHOLD, WARNING_THRESHOLD } from "../engine/boardReview";
import { defaultClubFinanceState } from "../types/clubFinance";
import { MEANING_TOKENS } from "../theme/clubTokens";
import { confidenceLabel } from "../narrative/annualReport";

/**
 * ROADMAP #14 — the Dashboard's window onto the pride and job-security layers: where the board stands
 * (confidence, any formal warning, how long the contract has to run and what renewal needs), the member
 * base and Football Dept budget, and the club's most recent financial milestones. Everything is read
 * from the same `ClubFinanceState.history` / `CoachSave` the Club History tab and Annual Report use.
 */
export function ClubStatusCard({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const myClub = useGameStore((s) => s.myClub);
  const year = useSaveStore((s) => s.year);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const coach = useCareerStore((s) => s.coach);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();
  const history = historyOf(state);
  const board = [...history].reverse().find((h) => h.board)?.board;
  const milestones = useMemo(() => financeMilestones(history, myClub, clubFinance).reverse().slice(0, 3), [history, myClub, clubFinance]);
  const endYear = coach ? contractEndYear(coach, year) : null;
  const warned = coach?.warnedYear !== undefined;
  const finalYear = endYear !== null && endYear <= year;
  const label = { font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5" } as const;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={label}>THE BOARD & THE BOOKS</div>
        {onOpenHistory && (
          <button type="button" onClick={onOpenHistory} style={{ background: "none", border: 0, padding: 0, color: "var(--accT)", font: "600 13px Barlow,sans-serif", cursor: "pointer" }}>
            Club history →
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ font: "700 34px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>{board?.confidence ?? 60}</span>
            <span style={{ font: "600 14px Barlow,sans-serif", color: "var(--accT)" }}>{confidenceLabel(board?.confidence ?? 60)}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
            <div style={{ width: `${board?.confidence ?? 60}%`, height: "100%", background: warned ? MEANING_TOKENS.fall : "var(--acc)" }} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {warned && <StatusChip tone="bad">Formal warning</StatusChip>}
            {endYear !== null && <StatusChip tone={finalYear ? "warn" : "neutral"}>{finalYear ? "Final contract year" : `Contract to ${endYear}`}</StatusChip>}
          </div>
          <div style={{ font: "500 12px/1.45 Barlow,sans-serif", color: "#8f9ab0" }}>
            {warned
              ? `Below ${WARNING_THRESHOLD} again at the next review and the board will sack you.`
              : finalYear
                ? `The board renews at ${RENEW_THRESHOLD}+ confidence.`
                : board
                  ? "Board confidence, out of 100."
                  : "The board's first verdict comes when this season's books close."}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Stat k="Members" v={state.members?.toLocaleString("en-AU") ?? "—"} />
          <Stat k="Football Dept budget" v={moneyShort(state.budget)} />
          <Stat k="Net assets" v={state.netAssets !== undefined ? moneyShort(state.netAssets) : "—"} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: "1.2px", color: "#e8c25a" }}>RECENT MILESTONES</div>
          {milestones.length === 0 ? (
            <div style={{ font: "500 13px/1.45 Barlow,sans-serif", color: "#8f9ab0" }}>None yet. Records and membership milestones appear here as you set them.</div>
          ) : (
            milestones.map((m, i) => (
              <div key={`${m.year}-${m.kind}-${i}`} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ font: "600 11px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>{m.year}</span>
                <span style={{ font: "500 13px Barlow,sans-serif", color: "#eef2f8" }}>★ {m.label}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3" }}>{k}</span>
      <span style={{ font: "600 13px 'IBM Plex Mono',monospace", color: "#fff" }}>{v}</span>
    </div>
  );
}
