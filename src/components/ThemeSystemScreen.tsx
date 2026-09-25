import { CLUBS } from "../types/club";
import { CLUB_TOKENS } from "../theme/clubTokens";
import { clubThemeStyle } from "../theme/useClubTheme";
import { Card, ClubStripe, ClubChip, StatusChip, KpiTile, TrendValue, Medal, DivergingBar, BarSolidGhost, Pips, PinStar, Toggle } from "./theme/primitives";
import { useState } from "react";

/**
 * Round 114 — Club Theme System, brief screen 8: "a dev/QA screen showing the
 * 5 tokens, the 4 rules and all 18 club cards. Keep it in dev builds." Doubles
 * as this round's own verification tool — every club's tokens render as a
 * real card here, in the same primitives every other screen will use, so a
 * broken token or a primitive that doesn't hold up under a light-accent club
 * (Carlton, Collingwood) or a dark-on-accent club (Brisbane, Richmond,
 * Hawthorn) shows up immediately rather than only surfacing later on a real
 * screen. Nav-gated to dev builds only (see App.tsx) per the brief.
 */
export function ThemeSystemScreen() {
  const [pinDemo, setPinDemo] = useState(false);
  const [toggleDemo, setToggleDemo] = useState(true);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5", marginBottom: 10 }}>
          THE 4 RULES THAT MATTER MOST
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, font: "400 13px Barlow,sans-serif", color: "#dfe5ee" }}>
          <div>
            <b style={{ color: "#fff" }}>1. Tint, don't paint.</b> Neutrals stay neutral; surfaces mix{" "}
            <code>var(--deep)</code> into them via <code>color-mix</code>.
          </div>
          <div>
            <b style={{ color: "#fff" }}>2. Accent means "yours".</b> <code>--acc</code> only on your primary
            actions, active states, your rows/players/chart line, and the club stripe.
          </div>
          <div>
            <b style={{ color: "#fff" }}>3. Meaning never depends on club colour.</b> Rises are always green,
            falls always coral, warnings amber, medals gold/silver/bronze — even for the six red clubs below.
          </div>
          <div>
            <b style={{ color: "#fff" }}>4. Other clubs are chips only.</b> An opponent's colours live inside
            their own scoped chip, never the app-wide theme.
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5", marginBottom: 10 }}>
          MEANING TOKENS (NEVER CLUB-COLOURED)
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <TrendValue value={2.1} />
          <TrendValue value={-1.4} />
          <StatusChip tone="warn">Needs attention</StatusChip>
          <Medal rank={1} />
          <Medal rank={2} />
          <Medal rank={3} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }}>
            <DivergingBar value={2.3} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }}>
            <BarSolidGhost solid={0.6} ghost={0.8} />
          </div>
          <Pips level={3} underConstruction={3} />
          <PinStar pinned={pinDemo} onToggle={() => setPinDemo((p) => !p)} />
          <Toggle on={toggleDemo} onChange={() => setToggleDemo((t) => !t)} label="Demo toggle" />
        </div>
      </Card>

      <div>
        <div style={{ font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: "1.5px", color: "#9aa4b5", marginBottom: 10 }}>
          ALL 18 CLUBS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
          {CLUBS.map((club) => {
            const tokens = CLUB_TOKENS[club.abbreviation];
            if (!tokens) return null;
            return (
              <div key={club.abbreviation} style={{ ...clubThemeStyle(tokens), borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,.08)" }}>
                <ClubStripe />
                <div
                  style={{
                    background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)",
                    padding: "16px 16px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ font: "700 18px 'Barlow Condensed',sans-serif", color: "#fff" }}>{club.name}</div>
                    <ClubChip>{club.abbreviation}</ClubChip>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <KpiTile value="49.9" label="Avg OVR" />
                    <KpiTile value="1" label="Elite 84+" tone="accent" />
                  </div>
                  <button
                    type="button"
                    style={{
                      background: "var(--acc)",
                      color: "var(--on)",
                      border: 0,
                      borderRadius: 9,
                      padding: "9px 14px",
                      font: "700 13px Barlow,sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    Primary action
                  </button>
                  <div style={{ font: "500 11px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>Accent text on dark: {tokens.acc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
