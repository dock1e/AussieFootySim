import { useEffect, useMemo, type CSSProperties } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useCareerStore } from "../store/useCareerStore";
import { clubByName, clubById } from "../types/club";
import { clubTokensFor } from "../theme/clubTokens";
import { clubThemeStyle } from "../theme/useClubTheme";
import { BARLOW, COND, MONO } from "./matchday/shared";
import { jobOffersFor } from "../narrative/jobMarket";
import type { ClubContext } from "../narrative/clubContext";

/**
 * ROADMAP #14 job security — shown after the Annual Report when the board has sacked the coach or
 * declined to renew the contract. The save carries on: pick one of the clubs that have called
 * (`narrative/jobMarket.ts`), on that club's own board brief and contract, or retire and start a new
 * game. There's no "close" — the coach has no club until they choose.
 */

const STATUS_LABEL: Record<ClubContext["status"], string> = {
  contender: "Contender",
  rising: "On the rise",
  middle: "Middle of the pack",
  sleepingGiant: "Sleeping giant",
  reset: "Needs a reset",
  rebuild: "Rebuilding",
};

export function JobMarket({ onRetire }: { onRetire: () => void }) {
  const myClub = useGameStore((s) => s.myClub);
  const year = useSaveStore((s) => s.year);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const acceptJobOffer = useSaveStore((s) => s.acceptJobOffer);
  const coach = useCareerStore((s) => s.coach);
  const seniorCoaches = useSaveStore((s) => s.seniorCoaches);
  const history = clubFinance[myClub]?.history ?? [];
  const lastOutcome = history[history.length - 1]?.board?.review === "notRenewed" ? "notRenewed" : "sacked";

  const offers = useMemo(
    () => (coach ? jobOffersFor({ coach, myClub, year, seasonArchives, seniorCoaches }) : []),
    [coach, myClub, year, seasonArchives, seniorCoaches],
  );

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!coach) return null;
  const formerAbbr = clubByName(myClub)?.abbreviation;
  const page: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    overflowY: "auto",
    background: "#0b0f17",
    color: "#fff",
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Job offers" style={page}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 16px 48px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <div style={{ font: `600 11px ${MONO}`, letterSpacing: "2px", color: "#ffa37a" }}>
            {lastOutcome === "sacked" ? "SACKED" : "CONTRACT NOT RENEWED"} · {formerAbbr ? `FORMERLY ${formerAbbr}` : ""}
          </div>
          <div style={{ font: `700 clamp(32px, 6vw, 52px)/1.05 ${COND}`, marginTop: 6 }}>{coach.name} is looking for a club</div>
          <div style={{ font: `500 15px/1.5 ${BARLOW}`, color: "#c3cbd8", marginTop: 8, maxWidth: 640 }}>
            {offers.length} club{offers.length === 1 ? " wants" : "s want"} to talk about the {year} season. Your record comes with you
            {coach.premierships ? `, including ${coach.premierships} premiership${coach.premierships === 1 ? "" : "s"}` : ""}. Your assistant coaches stay behind.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
          {offers.map((o) => (
            <OfferCard key={o.context.clubId} offer={o.context} note={o.note} onTake={() => acceptJobOffer(o.context.clubId, { expectation: o.context.expectation, patience: o.context.patience, contractYears: o.context.contractYears })} />
          ))}
        </div>

        {(coach.pastClubs?.length ?? 0) > 0 && (
          <div style={{ font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>
            Career so far:{" "}
            {coach.pastClubs!.map((c, i) => (
              <span key={`${c.clubId}-${c.fromYear}`}>
                {i > 0 ? " · " : ""}
                {clubById(c.clubId)?.name} {c.fromYear}–{c.toYear} ({c.reason === "sacked" ? "sacked" : "not renewed"})
              </span>
            ))}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={onRetire}
            style={{ border: "1px solid rgba(255,255,255,.25)", borderRadius: 10, padding: "11px 18px", font: `700 14px ${BARLOW}`, cursor: "pointer", background: "transparent", color: "#fff" }}
          >
            Retire and start a new game
          </button>
        </div>
      </div>
    </div>
  );
}

function OfferCard({ offer, note, onTake }: { offer: ClubContext; note: string; onTake: () => void }) {
  const style: CSSProperties = {
    ...clubThemeStyle(clubTokensFor(offer.id)),
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "18px",
    borderRadius: 14,
    border: "1px solid color-mix(in oklch, var(--acc) 45%, transparent)",
    background: "radial-gradient(120% 90% at 20% 0%, color-mix(in oklch, var(--deep) 80%, #0d1119) 0, #0d1119 75%)",
  };
  const row = (k: string, v: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, font: `500 13px ${BARLOW}`, color: "#c3cbd8" }}>
      <span>{k}</span>
      <b style={{ color: "#fff" }}>{v}</b>
    </div>
  );
  return (
    <div style={style}>
      <div>
        <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: "var(--accT)" }}>{STATUS_LABEL[offer.status].toUpperCase()}</div>
        <div style={{ font: `700 30px/1.05 ${COND}` }}>{offer.club}</div>
        <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>{offer.nick} · {offer.ground}</div>
        <div style={{ font: `600 12px ${BARLOW}`, color: "#ffa37a", marginTop: 4 }}>{note}</div>
      </div>
      {row("Last season", offer.finish ?? "—")}
      {row("Board's brief", offer.expectation)}
      {row("Board patience", `${offer.patience} / 5`)}
      {row("Contract", `${offer.contractYears} seasons`)}
      {offer.star && row("Best player", `${offer.star.name} (${offer.star.ovr})`)}
      <button
        type="button"
        onClick={onTake}
        style={{ marginTop: 6, border: 0, borderRadius: 10, padding: "11px 16px", font: `700 14px ${BARLOW}`, cursor: "pointer", background: "var(--acc)", color: "var(--on)" }}
      >
        Take the {offer.nick} job
      </button>
    </div>
  );
}
