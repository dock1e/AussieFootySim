import { useMemo, useState } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useDraftStore } from "../store/useDraftStore";
import { useCombineStore } from "../store/useCombineStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { buildLeaguePlayersByClub } from "../engine/listNeeds";
import {
  potentialLetterGrade,
  scoutOvrBand,
  scoutConfidence,
  scoutAccuracyFor,
  mockProjection,
  MOCK_OUTLETS,
  likelyNeedForClub,
  SCOUT_HEADLINE_ATTRIBUTES,
  DRAFT_ROUNDS,
  SCOUT_BUDGET_PER_DRAFT,
  scoutingTiersForPool,
  scoutingReportFor,
  scoutingSummaryFor,
  playsLikeFor,
  playsLikeConfidenceLabel,
  predictedDraftRange,
  primaryTieFor,
  type MockOutlet,
  type ScoutingTier,
  type PredictedDraftRange,
  type DraftPickRecord,
} from "../engine/draft";
import type { DraftWindow } from "../engine/saveGame";
import type { RealProspectTie } from "../data/realProspects";
import { ARCHETYPE_LINE, LINES, type Line } from "../data/lines";
import type { Archetype } from "../types/archetype";
import { CLUBS } from "../types/club";
import { ALL_PLAYERS, getPlayerById } from "../data/loadPlayers";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import type { Coach, ScoutFocusArea } from "../types/coach";
import { playerFullName, type Player, type RatedAttribute } from "../types/player";
import { StatusPill, type PillTone } from "./StatusPill";
import { Modal } from "./Modal";
import { ListNeeds } from "./ListNeeds";
import { PlayerLink } from "./PlayerLink";
import { ClubBadgeByName } from "./ClubBadge";
import { MEANING_TOKENS } from "../theme/clubTokens";
import { Toggle } from "./theme/primitives";

/**
 * National Draft — Phase 4 Slice 5 (ROADMAP.md). User Interface.md's Draft
 * screen: header (on-the-clock + Skip to My Pick/Next Pick/Finish Draft),
 * the fogged draft board, a Prospect Profile side panel, Recent Picks,
 * Upcoming Selections, and "Your Draft Picks Tonight." Reuses engine/draft.ts
 * for everything — this file is purely presentation + the 3 local UI-only
 * decisions the spec doesn't pin down:
 *
 * - **"Pathway"** (spec's own board column) is shown as **State** instead —
 *   no recruitment-pathway data (Academy/NAB League/international/etc.) is
 *   modelled anywhere in this codebase (Academy bids are an explicit,
 *   disclosed cut, see draft.ts's own doc comment), but home state is real,
 *   generated data and serves a similar "where'd they come from" role.
 * - **The `COMBINE` tag + `COMBINE ONLY` filter** (User Interface.md names
 *   both) now do something real, closing that gap from this slice's own
 *   original scope note: if this year's National Combine has been run (see
 *   engine/combine.ts, Phase 4 "Slice 6"), whichever of this board's
 *   prospects were among its `COMBINE_INVITE_COUNT` (80) tested invitees get
 *   a small tag next to their name, and the toggle filters the board down to
 *   just them. Reads directly off `useCombineStore`'s window for the current
 *   year — no combine, or a stale prior-year one, and the tag/toggle simply
 *   don't appear (this board works exactly as it always did if Combine was
 *   skipped this off-season).
 * - **POTENTIAL reads as a bare "?" until at least one headline attribute
 *   has been scouted on that prospect**, not just before the coach has
 *   opened their profile — a deliberate choice (not spec-literal, which just
 *   says "A+ to D- or ?") that gives the scouting budget a second real
 *   purpose beyond narrowing the OVR band: without spending at least one
 *   reveal, a prospect's ceiling is a genuine unknown, not just a fuzzy one.
 *
 * No `VIA {CLUB}`/`SLIPPED -N` provenance tags anywhere (Trade Period
 * doesn't support trading picks yet, so every pick's provenance is trivially
 * "their own"), and no Academy `MATCH` tags in Recent Picks (Academy bids are
 * cut) — both omissions, not oversights.
 *
 * **Round 77**: the board's default sort is now `engine/draft.ts`'s new
 * `predictedDraftRange` (a "Predicted pick" column, e.g. "5-8"), with an
 * explicit 3-way toggle (Predicted/Overall/Potential) replacing the old
 * fixed `scoutOvrBand`-midpoint sort — Tyler's own instruction. "Predicted
 * pick" is deliberately NOT gated behind the scouting-reveal fog the same
 * way `mockProjection`'s 3 outlet cards already aren't: it's presented as
 * external/in-house draft-stock analysis, not something the coach's own
 * scouting spend reveals, so it (like the mock outlets) is visible for every
 * prospect regardless of `revealedAttrs`.
 *
 * **Round 83**: the Talent Scout half of [[Assistant Coaching System]] is now
 * live — `TalentScoutPanel` (new this round) lets the coach assign anyone
 * from `data/assistantCoachPool.ts` as their club's Talent Scout and
 * optionally direct them at one of the 6 `SCOUT_FOCUS_AREAS`. The resolved
 * per-prospect accuracy (`engine/draft.ts`'s `scoutAccuracyFor`) now feeds
 * every fog-of-war surface on this screen — the board's Scout OVR/Conf
 * columns, the Prospect Profile panel's own band/confidence/predicted range,
 * and the `predictedRangeByPlayerId` sort map — replacing the flat
 * `DEFAULT_SCOUT_ACCURACY` every one of those call sites used through round
 * 82. No scout assigned still reads byte-identical to every prior round.
 *
 * **Round 94 Part 2** — [[Season Grading, Post-Season Awards, and Player History]]'s own Player
 * Profile redesign round bundled two more Tyler asks: "our draft talent pool will also need a player
 * profile which can be opened and purveyed by the player" and "a section which shows the 1 or 2
 * sentence player writeup summary." `ProspectProfile` below gains a new "Summary" section
 * (`scoutingSummaryFor`, a truncation of the exact same `scoutingReportFor` text the fuller "Scouting
 * report" section already shows — one source of truth, never two disagreeing write-ups) and an
 * optional `onOpenProfile` button. `ProspectProfileModal` (new) is the "player profile which can be
 * opened" itself — a genuine modal overlay, reusing `ProspectProfile`'s exact content rather than a
 * parallel implementation, opened via that new button. Deliberately does NOT replace the existing
 * always-visible sidebar `ProspectProfile` (the interactive scouting/drafting workstation stays
 * exactly as fast to use — no modal round-trip needed just to spend one more scouting-budget reveal);
 * the modal is a bigger, considered "look this prospect over" view layered on top, matching how
 * rostered players already get both a click-to-select context AND a dedicated `PlayerProfileModal`.
 *
 * **Round 97** — Tyler: "use your Claude Design features to rework the draft page... I want to reduce
 * the blank wasted space... that way the draft screen is focuses on the draft picks and the players
 * available." Three changes: (1) `TalentScoutPanel` moved off this screen entirely, onto the renamed
 * "Talent Scouting" tab (`Combine.tsx`) — this file keeps reading `talentScout` (still needed for
 * `accuracyFor`'s fog-of-war math below) but no longer renders the hiring UI itself. (2) The old bottom
 * row of 3 cards (Recent picks / Upcoming selections / Your draft picks tonight — frequently mostly
 * empty, e.g. "No picks yet") is replaced by `PickTicker`, one compact horizontal strip folded into the
 * header card right under "ON THE CLOCK" — recent picks, the live pick, and upcoming picks all visible
 * together without scrolling past the board, with `myClub`'s own entries visually flagged rather than
 * needing their own separate card. (3) The board gains a 4th sort mode ("Tier", sorting by the same true
 * unfogged tier `predictedDraftRange` itself uses — matching the "sort key is the true value, display
 * stays fogged" precedent "Overall"/"Potential" already established, see `SortMode`'s own doc comment)
 * and a Scouting Confidence filter (`minConfidence`), both matching the existing pill-button visual
 * language rather than introducing a new control style.
 *
 * **Round 98** — Tyler's own UI review of this screen once round 97 was live: "the player details on
 * the right hand side appears to be bolted on the side and the overall layout of the screen is
 * unbalanced," plus 6 more concrete asks. Fixes, in order: (1) the sidebar now gets its own "Scouting
 * profile" header (visual parity with the board's "Draft board (N available)" header) and a real
 * bordered empty-state placeholder instead of one stray line of text. (2) The board/sidebar grid gains
 * `items-start` — CSS Grid's default `align-items: stretch` was coupling the two columns' heights, so
 * opening a prospect's (taller) profile visibly grew the board card too even though the board's own
 * table has a fixed `max-h-[32rem]` cap; each card now sizes to its own content, permanently. (3) The
 * "Sort:" pill row is gone — `SortableHeader` turns the Predicted pick/Scout OVR/Pot./Scouting tier
 * columns themselves into the sort control, matching the click-a-column-header convention
 * `Records.tsx`'s own This-Season table already established, and incidentally fixes a pre-existing
 * alignment bug (the "Predicted pick" header lacked the `text-right` its own data cells had). (4) Every
 * drafted player's name — both in "Your picks tonight" and in `PickTicker`'s recent-picks chips — is now
 * a `PlayerLink`, opening that player's profile via `getPlayerById(playerId)` the same way every other
 * screen's roster names already do (upcoming-pick chips have no player yet, so stay plain). (5) "ON THE
 * CLOCK" wording is gone from both the header title and `PickTicker`'s live-pick chip (now "Picking
 * now"/"Your pick now") — Tyler: "I have no intention of bringing in a clock feature," so the UI no
 * longer implies one exists. (6) A new always-visible "List Needs" header button opens `<ListNeeds />`
 * (already a zero-required-props, fully self-contained component) inside the existing `Modal` primitive
 * — Tyler: "relevant to my decision making," so it's reachable without leaving the draft board.
 *
 * **Round 99** — Tyler shared a Claude Design mockup ("Three-column cockpit") and asked for this
 * screen's layout and hierarchy to be reworked to match it: "Keep all existing data, logic and
 * colours — this is layout and hierarchy only." (His own numbered spec text actually described the
 * mockup's OTHER option — a bottom-docked inspector tray — but his screenshot and explicit follow-up
 * answer confirmed the true three-side-by-side-columns option was the one he wanted; built to match
 * the screenshot/mockup, not the text, wherever the two disagreed.) Changes:
 *
 * - The screen is now a full-height, non-scrolling app shell at `lg:` and above (App.tsx's shared
 *   shell gets a narrow, screen-scoped `isDraftCockpit` branch for this) — a merged status bar up top,
 *   a 3-column cockpit below it, and only the board's own rows and the two side columns scroll
 *   internally. Below `lg`, this screen deliberately falls back to its pre-round-99 scrollable,
 *   stacked layout unchanged — the mockup is a desktop cockpit, and a phone-width viewport was never
 *   part of Tyler's ask.
 * - The old header card + `PickTicker` merge into one status bar: a pick-number badge and round/club
 *   line on the left, `PickTicker` (now non-wrapping — it scrolls horizontally instead of wrapping to
 *   a second line, satisfying "no wrapping to a second line" without silently clipping chips) filling
 *   the middle, and every existing action button (List Needs, Next Pick, Skip to My Pick, Finish
 *   Draft) on the right. The mockup's own version of this bar also shows a scout-budget figure here —
 *   omitted, since the mockup's real 3-column layout (unlike the bottom-tray option) already places
 *   Scout Budget in the left sidebar, and showing the same figure twice added nothing.
 * - The right-hand "Scouting profile" column survives entirely — Tyler's screenshot/mockup choice
 *   keeps it, unlike the bottom-tray option his text described — but is now genuinely docked: a
 *   pinned name/meta header (extracted into a new `ProspectHeader`, shared with `ProspectProfile` so
 *   the two never drift), a scrollable middle carrying every existing section (Summary, Scouting
 *   tier, OVR/Potential tiles, Attributes, Scouting report, Plays like, Predicted range, Mock draft
 *   outlets — nothing cut), and a Draft-button footer pinned to the bottom so the primary action is
 *   never scrolled out of view. `ProspectProfile` gained a `hideHeader` flag for this split; every
 *   other caller (`ProspectProfileModal`) is untouched and renders exactly as it always has.
 * - A new left sidebar holds the Position/Min-Confidence/Combine-only filters (moved out of the old
 *   strip above the board — same `lineFilter`/`minConfidence`/`combineOnly` state, no new filter was
 *   invented), a real Scout Budget stat (`window_.scoutingBudgetRemaining` of `SCOUT_BUDGET_PER_DRAFT`,
 *   the real constant, not a placeholder), and "Your picks tonight" (moved from the old header row).
 *   Position counts reflect the Combine/Confidence filters already applied (a small, deliberate reorder
 *   of the existing filter chain — combine → confidence → line, was line → combine → confidence — so
 *   the sidebar can show "how many prospects at this position, given my other filters" instead of a
 *   raw unfiltered count; the set of prospects the board ends up showing is unchanged either way).
 *   The mockup's own "Hide drafted" toggle has no backing feature anywhere in this codebase and was
 *   left out rather than faked.
 * - The board itself moves from a semantic `<table>` to CSS Grid rows sharing one literal
 *   `grid-template-columns` between the header and every data row (`BOARD_GRID_COLS`) — the mockup's
 *   own construction and the most direct way to satisfy "columns align exactly," with ARIA
 *   `table`/`row`/`columnheader`/`cell` roles standing in for the semantics the `<table>` used to give
 *   for free. Columns are the mockup's own fixed widths, every one centre-aligned except Prospect
 *   (left-aligned) and Confidence (now a small tier-coloured bar under the percentage, reusing
 *   `good`/`warn`/`bad` — no new colours). Column headers are noticeably narrower than round 98's, so
 *   long values (a handful of archetypes) can truncate to an ellipsis with a hover title — a
 *   consequence of Tyler's own literal pixel widths that round 96 had deliberately avoided by letting
 *   the table run wide; that trade-off reverses back here because this round's explicit ask is strict
 *   column alignment, not a wide scrolling table.
 * - `SortableHeader`'s active-sort tint moves from `accent` (orange) to `primary` (purple). Not
 *   asked for explicitly, but the mockup uses one purple thread for every "active/selected/current"
 *   signal on the page (the selected board row, the live pick chip, the primary CTA) and `accent`
 *   orange is documented elsewhere in this codebase as reserved for a "look at this, something
 *   exceptional" role — keeping the sort-active header orange would have fought that hierarchy rather
 *   than served it. Flagged here as the one visual-language call made without being asked, rather than
 *   silently folded in — everything else above maps onto data/logic/tokens that already existed.
 *
 * **Round 119** — [[Club Theme System]] re-theme. Every prior round above built and polished this
 * screen's real mechanics and layout on the app's OLD, pre-round-114 visual language (Tailwind
 * `bg-primary`/`text-primary-light` plus one-off literal hex like `#6d5ce8`/`#f0c419`/`#22d3a7`) — this
 * round swaps that visual layer for the Club Theme System's `var(--acc)`/`var(--accT)`/`var(--deep)`
 * tokens (per-club, set by `ScopedClub`/`clubThemeStyle` app-wide since round 114) and `MEANING_TOKENS`
 * (brief rule 5: "meaning never depends on club colour" — rise/fall/warn stay the same green/coral/amber
 * for every club, including the red-accented ones). No mechanic, prop, handler, filter, sort mode, or
 * data flow changes: every real system rounds 77-100 built (scouting budget/confidence bands/tiers,
 * predicted range, Combine tags, Father-Son/Academy ties, PickTicker, ProspectProfile/Modal) is
 * byte-identical in behaviour, just re-skinned. Mapping: "mine"/"selected"/"primary action" signals
 * (pick-hero badge, Skip-to-My-Pick button, active filter pills, the board's selected-row tint, the
 * Draft button, PickTicker's own-club highlights) move from the old flat purple `primary` token to
 * `var(--acc)`/`var(--accT)` so they read as this club's colour, not a fixed brand purple. Confidence
 * (`confidenceColor`/`ConfidenceBar`) and the scout-budget-exhausted advisory box move from their old
 * literal teal/yellow/red to `MEANING_TOKENS.rise`/`warn`/`fall` — these are meaning signals ("how sure
 * are we", "budget's out"), not club branding, so per rule 5 they must NOT vary by club. The
 * Combine-invite toggle now uses the shared `Toggle` primitive instead of a hand-rolled switch. Card
 * surfaces (board rows, Scout Budget tile, attribute/stat tiles) move from literal `#151d2e`/zebra hex to
 * the shared `color-mix(in oklch, var(--deep) ...)` tint convention `Card`/`List.tsx` already use. The
 * established shared neutral-grey palette (`#6f7c93`/`#c3ccdd`/etc. — `LABEL_CLASS` and plain body text)
 * is left as-is, same "neutrals aren't per-club colours" convention documented in rounds 117-118's own
 * verify scripts.
 */

const HEADLINE_ATTR_LABELS: Record<RatedAttribute, string> = {
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

function revealedFor(window: DraftWindow, playerId: number): RatedAttribute[] {
  return (window.revealed[playerId] ?? []) as RatedAttribute[];
}

/** Round 97 — shared by the "predicted" sort and as the tie-breaker inside "tier" sort; pulled out of
 * the old inline `midA`/`midB` sort-comparator locals now that two sort modes need the same midpoint. */
function predictedMidpoint(playerId: number, rangeByPlayerId: ReadonlyMap<number, PredictedDraftRange>): number {
  const range = rangeByPlayerId.get(playerId);
  return range ? (range.low + range.high) / 2 : Number.MAX_SAFE_INTEGER;
}

/** Round 77 board sort modes — "predicted" (the new default) sorts by `predictedDraftRange`'s own midpoint; "overall"/"potential" sort by the prospect's true (unfogged) OVR/POT directly, same "sort key is the true value, DISPLAY stays fogged" split the old default sort already used via `scoutOvrBand`.
 *
 * Round 97 adds "tier" — Tyler: "sort and order the players by... Scouting Tier." Sorts by the
 * prospect's true `ScoutingTier` (via `tierByPlayerId`, the same whole-pool map the board's Scouting
 * Tier column and the AI's own draft logic now share, see draft.ts's `tierRankBonus`), Generational
 * Talent first — same true-value-even-though-display-stays-fogged precedent as "overall"/"potential"
 * above. Ties within a tier fall back to predicted-pick midpoint so the ordering stays meaningful.
 */
type SortMode = "predicted" | "overall" | "potential" | "tier";

/** Round 97 — Tyler: "filter based on the scouting confidence." Coarse bands match this board's
 * existing pill-button filter language (Line/Combine-only) rather than a raw numeric slider. 0 = no
 * filter (every prospect, scouted or not, since an un-scouted prospect's confidence reads as 0%). */
const CONFIDENCE_LEVELS = [0, 50, 70, 90] as const;

/** Round 98, Tyler: "even the Sort Buttons - do these need to be buttons or can these be sortable by
 * clicking on the column headers." Shared sortable column-header cell for the draft board — mirrors
 * Records.tsx's own sortable-column convention (cursor-pointer, hover highlight, active-state tint,
 * small `▾` indicator) rather than inventing a new visual language for "click to sort." Every mode here
 * keeps the same fixed "best prospects first" direction it always had as a pill button — Tyler asked
 * for clickable headers, not a new ascending/descending toggle.
 *
 * Round 99 — the board moved from a `<table>` to CSS Grid rows (see `BOARD_GRID_COLS`), so this renders
 * a `role="columnheader"` div instead of a `<th>`; default alignment flips from "left" to "center" to
 * match the mockup's "every column is text-align:center except Prospect" rule, and the active-state
 * tint moves from `accent` (orange) to `primary` (purple) — see this file's Round 99 doc comment for
 * why. */
function SortableHeader({
  label,
  active,
  onClick,
  align = "center",
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: "left" | "center" | "right";
  title: string;
}) {
  return (
    <div
      role="columnheader"
      aria-sort={active ? "descending" : "none"}
      onClick={onClick}
      title={title}
      style={active ? { background: "color-mix(in oklch, var(--acc) 15%, transparent)", color: "var(--accT)" } : undefined}
      className={`flex cursor-pointer items-center whitespace-nowrap px-2 py-2 ${
        align === "left" ? "justify-start text-left" : align === "right" ? "justify-end text-right" : "justify-center text-center"
      }`}
    >
      {label}
      {active && <span className="ml-0.5">▾</span>}
    </div>
  );
}

/** Round 99 — one literal grid-template-columns string shared by the board's header row and every data
 * row (Tyler: "single grid template shared by the header row and every data row so columns align
 * exactly"), copied from the chosen mockup's own board rather than from Tyler's typed pixel values
 * (which described the mockup's other, unchosen option). */
const BOARD_GRID_COLS = "grid-cols-[36px_74px_minmax(110px,1fr)_48px_96px_76px_50px_84px_58px]";

/** Round 99 — display label for the board's own "Sorted: X" hint, replacing round 98's separate "Sort:"
 * pill row now that the columns themselves are the sort control. */
const SORT_MODE_LABEL: Record<SortMode, string> = {
  predicted: "Predicted",
  overall: "Overall",
  potential: "Potential",
  tier: "Tier",
};

/** Round 100 — Draft cockpit accent polish (Tyler's "Prompt 1"): shared all-caps micro-label styling.
 * Applied to plain text nodes across the filter rail, board headers, and inspector stat tiles, so a
 * constant (matching `BOARD_GRID_COLS`/`SORT_MODE_LABEL`'s existing pattern) rather than a component. */
const LABEL_CLASS = "font-mono uppercase text-[9.5px] tracking-[1.1px] text-[#6f7c93]";

/** Round 100 — the mockup's own confidence-colour thresholds ("teal ≥48, yellow ≥40, red below"),
 * originally literal one-off hex. Round 119 — [[Club Theme System]] re-theme: confidence is a MEANING
 * signal ("how sure is this read"), not a club-branding one, so per the brief's rule 5 ("meaning never
 * depends on club colour") it now routes through `MEANING_TOKENS.rise`/`warn`/`fall` — the same
 * rise/fall/warn a Bulldogs fan and a Collingwood fan see for the identical confidence value, rather than
 * a colour that happened to double as this file's own old literal palette. Thresholds unchanged. */
function confidenceColor(value: number): string {
  return value >= 48 ? MEANING_TOKENS.rise : value >= 40 ? MEANING_TOKENS.warn : MEANING_TOKENS.fall;
}

/** Round 99 — the mockup's "Confidence renders as a small bar plus the percentage." Round 100: recoloured
 * to the mockup's own teal/yellow/red thresholds (`confidenceColor` above) in place of the app's global
 * good/warn/bad bands, per Tyler's explicit "Prompt 1" spec. */
function ConfidenceBar({ value }: { value: number }) {
  const tone = confidenceColor(value);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs tabular-nums">{value}%</span>
      <div className="h-1 w-10 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
        <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: tone }} />
      </div>
    </div>
  );
}

/** Round 100 — Draft cockpit accent polish (Tyler's "Prompt 1") accent #3: compact board-only pill tags
 * for Combine invites ("CMB", teal) and Father-Son/Academy/NGA ties (yellow), distinct from the existing
 * full `TieBadge`/`StatusPill("COMBINE")` treatments this file already uses in the docked inspector
 * column, where there's room for the full word and the destination club. The board's Prospect column is
 * narrow (`minmax(110px,1fr)`), so these carry only a short label. Round 119 re-theme: "CMB" is a
 * meaning signal (a positive fact about this prospect, same status for every club) so it keeps
 * `MEANING_TOKENS.rise`; the tie badge is about which CLUB can bid-match, so it moves to `var(--accT)` —
 * this club's own colour — rather than a fixed yellow. */
function BoardPill({ label, tone }: { label: string; tone: "teal" | "yellow" }) {
  // Round 119 — `color-mix` (not a literal `${hex}26` alpha suffix) so this still works now that the
  // "yellow"/tie case resolves to the CSS custom property `var(--accT)` rather than a literal hex string.
  const color = tone === "teal" ? MEANING_TOKENS.rise : "var(--accT)";
  const background = tone === "teal" ? `color-mix(in oklch, ${MEANING_TOKENS.rise} 15%, transparent)` : "color-mix(in oklch, var(--accT) 18%, transparent)";
  return (
    <span
      className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase leading-none"
      style={{ backgroundColor: background, color }}
    >
      {label}
    </span>
  );
}

export function Draft() {
  const myClub = useGameStore((s) => s.myClub);
  const currentYear = useSaveStore((s) => s.year);
  const poolVersion = useSaveStore((s) => s.poolVersion);
  const startDraft = useSaveStore((s) => s.startDraft);
  const confirmDraftPick = useSaveStore((s) => s.confirmDraftPick);
  const autoResolveNextPick = useSaveStore((s) => s.autoResolveNextPick);
  const skipToMyPick = useSaveStore((s) => s.skipToMyPick);
  const finishDraft = useSaveStore((s) => s.finishDraft);
  const scoutAttribute = useSaveStore((s) => s.scoutAttribute);
  // Round 97 — the Talent Scout hiring UI itself (`assignTalentScout`/`setScoutFocusArea`) moved to
  // Combine.tsx ("Talent Scouting"); this file still reads `talentScout` below since the assigned
  // scout's accuracy keeps feeding every fog-of-war surface on this screen (`accuracyFor`).
  const talentScout = useSaveStore((s) => s.talentScout);
  const window_ = useDraftStore((s) => s.window);
  const combineWindow_ = useCombineStore((s) => s.window);
  const ladder = useSeasonStore((s) => s.season?.ladder);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lineFilter, setLineFilter] = useState<Line | "All">("All");
  const [combineOnly, setCombineOnly] = useState(false);
  // Round 77 — Tyler's own instruction: "the default sort should be on their
  // predicted draft order and players should be able to sort the list by
  // Overall and Potential too."
  const [sortMode, setSortMode] = useState<SortMode>("predicted");
  // Round 97 — Tyler: "filter based on the scouting confidence." 0 = "Any" = no filter.
  const [minConfidence, setMinConfidence] = useState<(typeof CONFIDENCE_LEVELS)[number]>(0);
  // Round 94 Part 2 — which prospect's full profile modal is open, if any. Independent of
  // `selectedId` (the sidebar's own compact scouting-workstation selection) — a coach can browse the
  // fuller modal without losing or changing their board selection underneath it.
  const [profileModalId, setProfileModalId] = useState<number | null>(null);
  // Round 98 — Tyler: "the list needs screen should be openable or expandable from my draft screen."
  const [listNeedsOpen, setListNeedsOpen] = useState(false);

  // Round 83 — [[Assistant Coaching System]]'s Talent Scout integration.
  // `assignedScout`/`focusArea` are resolved once here and threaded into
  // every scoutOvrBand/scoutConfidence/predictedDraftRange call below via
  // `accuracyFor`, rather than each call site re-deriving them.
  const assignedScout: Coach | null = talentScout ? (ASSISTANT_COACH_POOL.find((c) => c.id === talentScout.coachId) ?? null) : null;
  const focusArea: ScoutFocusArea | null = talentScout?.focusArea ?? null;
  const accuracyFor = (p: Player) => scoutAccuracyFor(p, assignedScout, focusArea);

  // Only meaningful if this year's Combine actually ran — a stale prior-year
  // window (or none at all) just means no prospect gets tagged, same as if
  // Combine had never been built.
  const combineInvitedIds = useMemo(
    () => (combineWindow_ && combineWindow_.year === currentYear ? new Set(combineWindow_.invitedPlayerIds) : null),
    [combineWindow_, currentYear],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playersByClub = useMemo(() => buildLeaguePlayersByClub(), [poolVersion]);

  // Sep 2026 — real prospect pool round. Computed once per draft night
  // (`window_.pool` is fixed for the whole night, see DraftWindow's own doc
  // comment), not once per rendered board row — matches
  // `scoutingTiersForPool`'s own doc comment on why it's a whole-pool
  // function rather than a per-prospect one.
  const tierByPlayerId = useMemo(() => (window_ ? scoutingTiersForPool(window_.pool) : new Map<number, ScoutingTier>()), [window_]);

  // Round 77 — same "computed once per draft night off the fixed window_.pool,
  // not once per rendered row" convention as tierByPlayerId above.
  // predictedDraftRange internally re-sorts the whole pool per call, so this
  // is O(n^2 log n) for n≈195 (~ok once per pool, not per keystroke).
  // Round 83 — depends on assignedScout/focusArea too now, so a scout
  // (re)assignment or focus change recomputes every prospect's range.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const predictedRangeByPlayerId = useMemo(() => {
    const map = new Map<number, PredictedDraftRange>();
    if (!window_) return map;
    for (const p of window_.pool) map.set(p.PlayerID, predictedDraftRange(p, window_.pool, accuracyFor(p)));
    return map;
  }, [window_, assignedScout, focusArea]);

  if (!window_) {
    return (
      <div className="space-y-6">
        <div className="card text-center">
          <div className="mb-2 font-display text-xl italic">The {currentYear} National Draft hasn&rsquo;t started yet.</div>
          <p className="mx-auto mb-4 max-w-md text-sm text-slate-400">
            {ladder && ladder.length > 0
              ? "Draft order is set from this season's final ladder — last place picks first, 5 rounds, 90 picks total."
              : "No season's been completed yet, so draft order falls back to a fixed club order for now — play a season first if you want a real reverse-ladder order."}
          </p>
          <button onClick={startDraft} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--acc)", color: "var(--on)" }}>
            Start the {currentYear} National Draft
          </button>
        </div>
      </div>
    );
  }

  const isComplete = window_.currentPickIndex >= window_.order.length;
  const clubOnClock = isComplete ? null : window_.order[window_.currentPickIndex];
  const isMyTurn = clubOnClock === myClub;
  const round = Math.min(DRAFT_ROUNDS, Math.floor(window_.currentPickIndex / CLUBS.length) + 1);

  const pickedIds = new Set(window_.picks.map((p) => p.playerId));
  const remaining = window_.pool.filter((p) => !pickedIds.has(p.PlayerID));
  // Round 99 — reordered from line→combine→confidence to combine→confidence→line (the RESULT,
  // `sortedRemaining`, is identical either way — set intersection doesn't care about order) so the new
  // sidebar's per-position counts can reflect "how many prospects at this position, given my other
  // filters" via `confidenceFiltered` below, rather than a raw unfiltered count.
  const combineFiltered = combineOnly && combineInvitedIds ? remaining.filter((p) => combineInvitedIds.has(p.PlayerID)) : remaining;
  // Round 97 — Tyler: "filter based on the scouting confidence." `scoutConfidence` needs the same
  // revealed-count + accuracy inputs the board's own Conf column already computes per row; recomputed
  // here at filter time too (same acceptable "cheap enough for ~195 rows" tradeoff `accuracyFor` already
  // makes) rather than restructuring the whole board into a single pre-computed-row-object pipeline.
  const confidenceFiltered =
    minConfidence === 0
      ? combineFiltered
      : combineFiltered.filter((p) => scoutConfidence(p, revealedFor(window_, p.PlayerID).length, accuracyFor(p)) >= minConfidence);
  const lineFiltered =
    lineFilter === "All" ? confidenceFiltered : confidenceFiltered.filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === lineFilter);
  // Round 99 — sidebar Position-filter counts, computed off `confidenceFiltered` (combine+confidence
  // applied, line not yet applied) so each button shows how many prospects that line would show given
  // the other active filters.
  const lineCounts = (["All", ...LINES] as const).map((line) => ({
    line,
    count: line === "All" ? confidenceFiltered.length : confidenceFiltered.filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === line).length,
  }));
  // Round 97 — true tier rank for "tier" sort mode; `tierByPlayerId` is computed off true POT/OVR (see
  // its own doc comment above), so this resolves even for a prospect with zero revealed attributes,
  // matching the "sort key is the true value" precedent "overall"/"potential" already established.
  const tierRank = (playerId: number): number => {
    const tier = tierByPlayerId.get(playerId);
    return tier ? TIER_RANK[tier] : 99;
  };
  const sortedRemaining = [...lineFiltered].sort((a, b) => {
    if (sortMode === "overall") return b.OVR - a.OVR;
    if (sortMode === "potential") return b.POT - a.POT;
    if (sortMode === "tier") {
      const rankDiff = tierRank(a.PlayerID) - tierRank(b.PlayerID);
      if (rankDiff !== 0) return rankDiff;
      return predictedMidpoint(a.PlayerID, predictedRangeByPlayerId) - predictedMidpoint(b.PlayerID, predictedRangeByPlayerId);
    }
    return predictedMidpoint(a.PlayerID, predictedRangeByPlayerId) - predictedMidpoint(b.PlayerID, predictedRangeByPlayerId);
  });
  const selected = selectedId !== null ? (remaining.find((p) => p.PlayerID === selectedId) ?? null) : null;

  const myPicks = window_.picks.filter((p) => p.clubName === myClub);
  // Round 97 — excludes the current on-the-clock pick (that's `clubOnClock`, shown separately/highlighted
  // in `PickTicker`); previously included it as `upcoming[0]`, double-counting it against the header's own
  // "ON THE CLOCK" line.
  const upcoming = window_.order.slice(window_.currentPickIndex + 1, window_.currentPickIndex + 5);

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:gap-3">
      {/* Round 99 — the old header card + `PickTicker` merged into one status bar. Stacks vertically on
          mobile (same info, just not squeezed into a fixed 64px strip); becomes the mockup's literal
          64px non-wrapping bar at `lg:` and above. */}
      {/* Round 100 — Tyler's "Prompt 1" accent #1: 60×44 pick-hero badge, purple→transparent gradient
          wash, 3px purple left edge. The mockup's own literal 1a section builds this as a dedicated
          216px sidebar (separate from the pick-order strip); Tyler's own text spec here explicitly
          adapts that into an accent on round 99's already-built compact status bar instead ("don't
          change the layout skeleton"), so the gradient/edge are layered onto the existing bar rather
          than reproducing the mockup's different structure. Purple is the app's own `primary` token
          (#6d5ce8), not the mockup's literal #7c5cf0 — see this file's colour-token notes. */}
      <div
        className="flex flex-col gap-2 rounded-card border p-3 lg:h-16 lg:flex-row lg:items-center lg:gap-3 lg:py-0"
        style={{
          borderColor: "rgba(255,255,255,.07)",
          borderLeftWidth: 3,
          borderLeftColor: "var(--acc)",
          background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)",
          backgroundImage: "linear-gradient(90deg, color-mix(in oklch, var(--acc) 16%, transparent), color-mix(in oklch, var(--acc) 2%, transparent) 45%, transparent 65%)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 lg:shrink-0 lg:flex-nowrap lg:justify-start">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-11 w-[60px] shrink-0 flex-col items-center justify-center rounded-lg leading-none"
              style={{ background: "var(--acc)", color: "var(--on)" }}
            >
              <span className="font-display text-[22px] font-semibold tabular-nums">{isComplete ? "—" : window_.currentPickIndex + 1}</span>
              <span className="font-mono text-[7.5px] uppercase tracking-wide opacity-80">Pick</span>
            </div>
            <div className="min-w-0">
              {/* Round 100 — matches the mockup's own "ROUND 4 OF 5 · ON THE CLOCK" label styling
                  (9.5px IBM Plex Mono, #6f7c93) via `LABEL_CLASS`, completing accent #1. */}
              <div className={`truncate ${LABEL_CLASS}`}>
                {currentYear} National Draft · Round {round}/{DRAFT_ROUNDS}
              </div>
              <div className="truncate font-display text-base italic">{isComplete ? "Draft complete" : `${clubOnClock} is picking`}</div>
            </div>
          </div>
        </div>

        {!isComplete && (
          <div className="min-w-0 lg:flex-1">
            <PickTicker
              recentPicks={window_.picks}
              currentPickNumber={window_.currentPickIndex + 1}
              clubOnClock={clubOnClock}
              upcomingClubs={upcoming}
              myClub={myClub}
              playersByClub={playersByClub}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
          {/* Round 98 — Tyler: "the list needs screen should be openable or expandable from my draft
              screen as this is relevant to my decision making." Always visible (not gated on
              `!isComplete`) — reviewing needs stays useful even after the draft wraps up. */}
          <button onClick={() => setListNeedsOpen(true)} className="rounded-lg bg-base-700 px-3 py-1.5 text-xs font-semibold hover:bg-base-600">
            List Needs
          </button>
          {!isComplete && !isMyTurn && (
            <button onClick={autoResolveNextPick} className="rounded-lg bg-base-700 px-3 py-1.5 text-xs font-semibold hover:bg-base-600">
              Next Pick
            </button>
          )}
          {!isComplete && !isMyTurn && (
            <button
              onClick={skipToMyPick}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--acc)", color: "var(--on)" }}
            >
              Skip to My Pick
            </button>
          )}
          {!isComplete && (
            <button onClick={finishDraft} className="rounded-lg bg-base-700 px-3 py-1.5 text-xs font-semibold hover:bg-base-600">
              Finish Draft
            </button>
          )}
        </div>
      </div>

      {isComplete ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="card max-w-md text-center">
            <div className="mb-1 font-display text-xl italic">The {currentYear} National Draft is complete.</div>
            <div className="text-sm text-slate-400">
              {myClub} made {myPicks.length} pick{myPicks.length === 1 ? "" : "s"}. Pre-Season Draft and Pre-Season Investment aren&rsquo;t built yet.
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 overflow-hidden rounded-card border border-base-700 bg-base-800 lg:min-h-0 lg:flex-1 lg:grid-cols-[216px_minmax(0,1fr)_340px]">
          {/* Left sidebar — Round 99: Position/Min Confidence/Combine-only filters relocated here from
              the old strip above the board (same `lineFilter`/`minConfidence`/`combineOnly` state);
              Scout Budget and Your Picks Tonight relocated here from the old header row. */}
          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-base-700 p-3 text-sm lg:border-b-0 lg:border-r">
            <div>
              {/* Round 100 — Tyler's "Prompt 1" closing typography directive applied to every all-caps
                  rail label: IBM Plex Mono, 9.5px, 1.1px tracking, #6f7c93 (`LABEL_CLASS`). */}
              <div className={`mb-1.5 ${LABEL_CLASS}`}>Position</div>
              <div className="flex flex-col gap-0.5">
                {lineCounts.map(({ line, count }) => (
                  <button
                    key={line}
                    onClick={() => setLineFilter(line)}
                    style={lineFilter === line ? { background: "var(--acc)", color: "var(--on)" } : undefined}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold ${
                      lineFilter === line ? "" : "text-slate-300 hover:bg-base-700"
                    }`}
                  >
                    <span>{line}</span>
                    {/* Round 100 — accent #4: counts already sat at the row's right edge (`justify-between`);
                        the missing accent was the mockup's monospace treatment on the figure itself. */}
                    <span className={`font-mono ${lineFilter === line ? "opacity-80" : "text-slate-500"}`}>{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={`mb-1.5 ${LABEL_CLASS}`}>Min Confidence</div>
              <div className="grid grid-cols-4 gap-1">
                {CONFIDENCE_LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => setMinConfidence(level)}
                    title={level === 0 ? "Any scouting confidence" : `At least ${level}% scouting confidence`}
                    style={minConfidence === level ? { background: "var(--acc)", color: "var(--on)" } : undefined}
                    className={`rounded-lg px-1 py-1.5 text-center text-[11px] font-semibold ${
                      minConfidence === level ? "" : "bg-base-700 text-slate-300 hover:bg-base-600"
                    }`}
                  >
                    {level === 0 ? "Any" : `${level}%`}
                  </button>
                ))}
              </div>
            </div>

            {combineInvitedIds && (
              <div className="flex items-center justify-between gap-2">
                <span className={LABEL_CLASS}>Combine only</span>
                {/* Round 119 — shared `Toggle` primitive (brief 2.6) in place of the old hand-rolled
                    switch; same `combineOnly` state, no behaviour change. */}
                <Toggle on={combineOnly} onChange={() => setCombineOnly((v) => !v)} label="Show only this year's National Combine invitees" />
              </div>
            )}

            {/* Round 100 — accent #4: "Scout Budget is a tile with a big yellow number and a progress
                bar." Round 119 re-theme: the card surface moves to the shared `Card`-style
                `color-mix(in oklch, var(--deep) ...)` tint, and the figure/bar move from a literal yellow
                to `var(--accT)`/`var(--acc)` — this is the club's OWN resource to spend, not a
                meaning/warning signal, so it takes the club's colour like every other "yours" stat. */}
            <div className="rounded-lg border p-2.5" style={{ borderColor: "rgba(255,255,255,.07)", background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)" }}>
              <div className={`mb-1 ${LABEL_CLASS}`}>Scout Budget</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-2xl font-bold tabular-nums" style={{ color: "var(--accT)" }}>
                  {window_.scoutingBudgetRemaining}
                </span>
                <span className="text-[11px] text-slate-500">of {SCOUT_BUDGET_PER_DRAFT} left</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, (window_.scoutingBudgetRemaining / SCOUT_BUDGET_PER_DRAFT) * 100))}%`,
                    background: "var(--acc)",
                  }}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <div className={`mb-1.5 ${LABEL_CLASS}`}>Your Picks Tonight</div>
              {myPicks.length === 0 ? (
                <div className="text-xs text-slate-600">No picks yet.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {myPicks.map((rec) => {
                    // Round 98 — Tyler: "for the 'My picks tonight'... I should have the option to open
                    // the player profile by clicking their names." Same `getPlayerById`-fallback pattern
                    // as PickTicker's recent-picks chips.
                    const pickedPlayer = getPlayerById(rec.playerId);
                    return (
                      <div key={rec.pickNumber} className="truncate text-xs text-slate-300">
                        <span className="text-slate-500">
                          R{rec.round}/P{rec.pickNumber}
                        </span>{" "}
                        {pickedPlayer ? <PlayerLink player={pickedPlayer}>{rec.playerName}</PlayerLink> : rec.playerName}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Middle — Round 99: the board, moved from a `<table>` to CSS Grid rows sharing
              `BOARD_GRID_COLS` between the header and every data row so columns align exactly. Filter
              chips that used to live in this header moved to the sidebar; this header is now just the
              count + the sort-discoverability hint 1a's own mockup keeps here. */}
          <div className="flex min-h-0 flex-col overflow-hidden p-3">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              {/* Round 100 — Tyler's "Prompt 1" closing typography directive (IBM Plex Mono all-caps
                  labels) applied to the board's own section title and column-header row, completing the
                  same treatment already given the filter rail's labels. */}
              <span className={LABEL_CLASS}>Draft board ({remaining.length} available)</span>
              <span className="truncate text-[10px] normal-case tracking-normal text-slate-600">
                Sorted: {SORT_MODE_LABEL[sortMode]} ▾ · Click a column header to sort
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-base-700" role="table">
              <div
                role="row"
                className={`sticky top-0 z-10 grid ${BOARD_GRID_COLS} h-[34px] items-center border-b border-base-700 bg-base-900 ${LABEL_CLASS}`}
              >
                <div role="columnheader" className="flex items-center justify-center px-2">
                  #
                </div>
                <SortableHeader
                  label="Pred."
                  active={sortMode === "predicted"}
                  onClick={() => setSortMode("predicted")}
                  title="Sort by predicted draft position (best prospects first)"
                />
                <div role="columnheader" className="flex items-center px-2 text-left">
                  Prospect
                </div>
                <div role="columnheader" className="flex items-center justify-center px-2">
                  State
                </div>
                <div role="columnheader" className="flex items-center justify-center px-2">
                  Archetype
                </div>
                <SortableHeader
                  label="OVR"
                  active={sortMode === "overall"}
                  onClick={() => setSortMode("overall")}
                  title="Sort by true overall rating — the displayed band stays fogged"
                />
                <SortableHeader
                  label="Pot."
                  active={sortMode === "potential"}
                  onClick={() => setSortMode("potential")}
                  title="Sort by true potential — the displayed grade stays fogged"
                />
                <SortableHeader
                  label="Tier"
                  active={sortMode === "tier"}
                  onClick={() => setSortMode("tier")}
                  title="Sort by true scouting tier — the displayed tier stays fogged until scouted"
                />
                <div role="columnheader" className="flex items-center justify-center px-2">
                  Conf
                </div>
              </div>
              <div role="rowgroup">
                {sortedRemaining.map((p, i) => {
                  const revealed = revealedFor(window_, p.PlayerID);
                  const accuracy = accuracyFor(p);
                  const band = scoutOvrBand(p, revealed.length, accuracy);
                  const conf = scoutConfidence(p, revealed.length, accuracy);
                  const tie = primaryTieFor(p);
                  return (
                    <div
                      key={p.PlayerID}
                      role="row"
                      onClick={() => setSelectedId(p.PlayerID)}
                      // Round 100 — Tyler's "Prompt 1" accent #3: literal zebra hex (#101725/#131a29) and
                      // selected-row tint (rgba(124,92,240,.16), via `primary` at the mockup's own alpha)
                      // in place of round 99's `base-900`/`base-800/40`/`bg-primary/15`, matching the
                      // mockup's own embedded striping function exactly.
                      style={
                        selectedId === p.PlayerID
                          ? { background: "color-mix(in oklch, var(--acc) 16%, transparent)" }
                          : { background: i % 2 === 0 ? "rgba(255,255,255,.02)" : "transparent" }
                      }
                      className={`grid ${BOARD_GRID_COLS} h-[38px] cursor-pointer items-center border-b border-base-800 text-sm hover:bg-base-800/70`}
                    >
                      <div role="cell" className="px-2 text-center text-slate-500">
                        {i + 1}
                      </div>
                      <div role="cell" className="px-2 text-center tabular-nums" style={{ color: "var(--accT)" }}>
                        {(() => {
                          const range = predictedRangeByPlayerId.get(p.PlayerID);
                          if (!range) return "—";
                          return range.low === range.high ? range.low : `${range.low}-${range.high}`;
                        })()}
                      </div>
                      <div role="cell" className="flex min-w-0 items-center gap-1.5 px-2">
                        <span className="truncate font-medium">{playerFullName(p)}</span>
                        {combineInvitedIds?.has(p.PlayerID) && <BoardPill label="CMB" tone="teal" />}
                        {tie && <BoardPill label={TIE_TYPE_ABBR[tie.type]} tone="yellow" />}
                      </div>
                      <div role="cell" className="truncate px-2 text-center text-slate-400">
                        {p.homeState}
                      </div>
                      <div role="cell" className="truncate px-2 text-center text-slate-400" title={p.archetype}>
                        {p.archetype}
                      </div>
                      <div role="cell" className="px-2 text-center tabular-nums">
                        {band.low}-{band.high}
                      </div>
                      <div role="cell" className="px-2 text-center tabular-nums">
                        {revealed.length === 0 ? "?" : potentialLetterGrade(p.POT)}
                      </div>
                      <div role="cell" className="flex items-center justify-center px-2">
                        {revealed.length === 0 ? <span className="text-slate-500">?</span> : <CompactTierLabel tier={tierByPlayerId.get(p.PlayerID)} />}
                      </div>
                      <div role="cell" className="flex items-center justify-center px-2">
                        <ConfidenceBar value={conf} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right — Round 99: the docked scouting column survives (Tyler's screenshot/mockup choice
              keeps it), now genuinely docked — a pinned `ProspectHeader`, a scrollable body carrying the
              rest of `ProspectProfile` unabridged, and a Draft-button footer pinned to the bottom. */}
          <div className="flex min-h-0 flex-col overflow-hidden border-t border-base-700 lg:border-l lg:border-t-0">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selected ? (
                <div className="space-y-4">
                  <ProspectHeader
                    prospect={selected}
                    revealedAttrs={revealedFor(window_, selected.PlayerID)}
                    scoutAccuracy={accuracyFor(selected)}
                    onOpenProfile={() => setProfileModalId(selected.PlayerID)}
                  />
                  <ProspectProfile
                    prospect={selected}
                    pool={window_.pool}
                    tier={tierByPlayerId.get(selected.PlayerID)}
                    revealedAttrs={revealedFor(window_, selected.PlayerID)}
                    budgetRemaining={window_.scoutingBudgetRemaining}
                    scoutAccuracy={accuracyFor(selected)}
                    onScout={(attr) => scoutAttribute(selected.PlayerID, attr)}
                    hideHeader
                  />
                </div>
              ) : (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-base-700 px-4 py-10 text-center text-sm text-slate-500">
                  Select a prospect from the board to see their scouting profile.
                </div>
              )}
            </div>
            {selected && isMyTurn && (
              <div className="shrink-0 border-t border-base-700 bg-base-950 p-3">
                {/* Round 100 — Tyler's "Prompt 1" accent #5: full-width gradient Draft button (primary →
                    primary-dark, the mockup's own two-stop treatment using this app's actual token hex
                    rather than the mockup's literal slightly-different purple) plus Shortlist/Pass
                    beneath. Shortlist/Pass render — satisfying "add the missing visual accent" — but
                    stay disabled with a disclosing tooltip: a grep of this codebase turns up no
                    shortlist/watchlist/pass mechanic anywhere to wire them to, and this same file's own
                    round-99 precedent (the mockup's "Hide drafted" toggle) was to own a gap like this
                    rather than fake a working control. Flagged in this round's addendum for Tyler to
                    weigh in on building the real thing. */}
                {/* Round 119 — the mockup's own board footer button is a flat, solid `var(--acc)` fill
                    (brief `isDraft` section), not a gradient — the old two-stop purple gradient was this
                    file's own round-100 accent invention, not a mockup literal, so it's dropped here. */}
                <button
                  onClick={() => {
                    confirmDraftPick(selected.PlayerID);
                    setSelectedId(null);
                  }}
                  className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg"
                  style={{ background: "var(--acc)", color: "var(--on)" }}
                >
                  Draft {playerFullName(selected)}
                </button>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <button
                    disabled
                    title="Shortlisting isn't wired up yet — this is a placeholder for a future round."
                    className="cursor-not-allowed rounded-lg border border-white/10 bg-[#1a2233] px-2 py-2 text-[11px] font-semibold text-slate-300 opacity-50"
                  >
                    Add to Shortlist
                  </button>
                  <button
                    disabled
                    title="Passing isn't wired up yet — this is a placeholder for a future round."
                    className="cursor-not-allowed rounded-lg border border-white/10 bg-[#1a2233] px-2 py-2 text-[11px] font-semibold text-slate-300 opacity-50"
                  >
                    Pass
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {profileModalId !== null &&
        (() => {
          const modalProspect = window_.pool.find((p) => p.PlayerID === profileModalId) ?? null;
          if (!modalProspect) return null;
          return (
            <ProspectProfileModal
              prospect={modalProspect}
              pool={window_.pool}
              tier={tierByPlayerId.get(modalProspect.PlayerID)}
              revealedAttrs={revealedFor(window_, modalProspect.PlayerID)}
              budgetRemaining={window_.scoutingBudgetRemaining}
              scoutAccuracy={accuracyFor(modalProspect)}
              onScout={(attr) => scoutAttribute(modalProspect.PlayerID, attr)}
              onDraft={
                isMyTurn
                  ? () => {
                      confirmDraftPick(modalProspect.PlayerID);
                      setProfileModalId(null);
                      setSelectedId(null);
                    }
                  : undefined
              }
              onClose={() => setProfileModalId(null)}
            />
          );
        })()}

      {/* Round 98, Tyler: "the list needs screen should be openable or expandable from my draft screen
          as this is relevant to my decision making." `<ListNeeds />` (zero props) is already fully
          self-contained — the footer's own nav-shortcut buttons simply don't render without them, and
          nothing else about it needs wiring to work standalone inside this Modal. */}
      {listNeedsOpen && (
        <Modal title="List Needs" onClose={() => setListNeedsOpen(false)}>
          <ListNeeds />
        </Modal>
      )}
    </div>
  );
}

/** Round 97 — sort-order rank for the "Tier" sort mode; mirrors `TIER_TONE`'s own best-to-worst
 * ordering (Generational Talent first) rather than inventing a separate scale. */
const TIER_RANK: Record<ScoutingTier, number> = {
  "Generational Talent": 0,
  Superstar: 1,
  Elite: 2,
  Great: 3,
  Good: 4,
  Average: 5,
  "Sub-par": 6,
};

/**
 * Round 97 — Tyler: "When our draft picks are, especially our next pick is, who has been selected by
 * other clubs before us and who are the next subsequent picks" + "I want to reduce the blank wasted
 * space." Replaces the old bottom row of 3 cards (Recent picks / Upcoming selections / Your draft picks
 * tonight — frequently mostly empty walls of "No picks yet") with one compact horizontal strip folded
 * directly under the header's "ON THE CLOCK" line: the last few picks made, the live pick highlighted,
 * then the next few picks on deck, all in one glance with no separate cards or scrolling required.
 * `myClub`'s own picks (past or upcoming) get the same "bg-accent/10 ring-1 ring-accent/40"-style
 * highlight ring `SeasonHub.tsx`'s own fixture list already uses for "this is you" rows, rather than a
 * 4th "your picks" card — they're already visible in-line at their actual spot in the order. A hover
 * tooltip on each upcoming chip surfaces `likelyNeedForClub`'s existing "likely position of need" read,
 * preserving that information from the old "Upcoming selections" card without spending extra vertical
 * space on it.
 */
function PickTicker({
  recentPicks,
  currentPickNumber,
  clubOnClock,
  upcomingClubs,
  myClub,
  playersByClub,
}: {
  recentPicks: DraftPickRecord[];
  currentPickNumber: number;
  clubOnClock: string | null;
  upcomingClubs: string[];
  myClub: string;
  playersByClub: ReadonlyMap<string, Player[]>;
}) {
  const recent = recentPicks.slice(-4);
  return (
    // Round 99 — folded into the merged status bar's middle slot. At `lg:` and above, `flex-nowrap` +
    // `overflow-x-auto` satisfies the mockup's "one horizontal row... no wrapping to a second line" by
    // scrolling instead of wrapping or silently clipping; below `lg:` the status bar is no longer a
    // fixed-height strip, so wrapping stays allowed there (same as every other pre-round-99 screen). The
    // `border-t`/`pt-3` this used to need to separate itself from the header card above are gone now
    // that it isn't stacked under one anymore.
    <div className="scrollbar-none flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:overflow-x-auto">
      {/* Round 98 — Tyler: "for... the other players picked by other clubs I should have the option to
          open the player profile by clicking their names." Same `getPlayerById`-fallback pattern as
          "Your picks tonight" above. Round 100 — Tyler's "Prompt 1" accent #2: past picks fade from 55%
          to 75% opacity (oldest → most recent) rather than a flat opacity on every past chip, matching
          the mockup's own graduated fade; `scrollbar-none` (see index.css) hides the track while keeping
          the horizontal scroll Round 99 relied on to reach the live pick. */}
      {recent.map((rec, i) => {
        const pickedPlayer = getPlayerById(rec.playerId);
        const pastOpacity = 0.55 + (i / Math.max(recent.length - 1, 1)) * 0.2;
        return (
          <div
            key={rec.pickNumber}
            title={`Pick ${rec.pickNumber} · ${rec.clubName}`}
            style={{
              opacity: pastOpacity,
              background: rec.clubName === myClub ? "color-mix(in oklch, var(--acc) 10%, transparent)" : undefined,
              boxShadow: rec.clubName === myClub ? "inset 0 0 0 1px color-mix(in oklch, var(--acc) 40%, transparent)" : undefined,
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 ${rec.clubName === myClub ? "" : "bg-base-800"}`}
          >
            {/* Round 100 — matches the mockup's own literal ticker-numeral spec (9.5px IBM Plex Mono,
                #6f7c93) via the shared `LABEL_CLASS`. */}
            <span className={LABEL_CLASS}>#{rec.pickNumber}</span>
            <ClubBadgeByName name={rec.clubName} size="sm" />
            {pickedPlayer ? (
              <PlayerLink player={pickedPlayer} className="max-w-[8rem] truncate text-xs font-medium">
                {rec.playerName}
              </PlayerLink>
            ) : (
              <span className="max-w-[8rem] truncate text-xs font-medium">{rec.playerName}</span>
            )}
          </div>
        );
      })}

      {recent.length > 0 && clubOnClock && <span className="text-slate-600">→</span>}

      {clubOnClock && (
        <div
          style={
            clubOnClock === myClub
              ? { background: "var(--acc)", color: "var(--on)" }
              : { background: "color-mix(in oklch, var(--accT) 10%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--accT) 40%, transparent)" }
          }
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5"
        >
          {/* Round 100 — Tyler's "Prompt 1" accent #2: the pick number folds into the "#N · YOUR PICK"
              copy below for the user's own live pick (matching the mockup's chip verbatim), so the
              separate numeral badge only shows for the not-mine case, where that copy doesn't carry it. */}
          {clubOnClock !== myClub && <span className={LABEL_CLASS}>#{currentPickNumber}</span>}
          <ClubBadgeByName name={clubOnClock} size="sm" />
          {/* Round 98 — Tyler: "The 'On the Clock' is not required. I have no intention of bringing in a
              clock feature." Reworded to convey the same "whose turn" info without clock/timer framing. */}
          <span className="text-xs font-semibold" style={clubOnClock === myClub ? { letterSpacing: "0.02em" } : { color: "var(--accT)" }}>
            {clubOnClock === myClub ? `#${currentPickNumber} · YOUR PICK` : "Picking now"}
          </span>
        </div>
      )}

      {upcomingClubs.length > 0 && <span className="text-slate-600">→</span>}

      {upcomingClubs.map((club, i) => {
        const pickNumber = currentPickNumber + i + 1;
        const need = likelyNeedForClub(club, playersByClub);
        return (
          <div
            key={pickNumber}
            title={`Pick ${pickNumber} · ${club}${need ? ` · Likely: ${need}` : ""}`}
            // Round 100 — Tyler's "Prompt 1" accent #2: "your later picks get a dashed border," so a
            // future own-pick reads as "watch this one coming up" distinctly from a past own-pick's
            // steady tint above. Round 119 — moves from a fixed red to `var(--acc)` (this club's colour),
            // since it's marking a "this one's yours" fact, not a warning.
            style={club === myClub ? { borderStyle: "dashed", borderColor: "var(--acc)", borderWidth: 1 } : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 bg-base-800`}
          >
            <span className={LABEL_CLASS}>#{pickNumber}</span>
            <ClubBadgeByName name={club} size="sm" />
          </div>
        );
      })}
    </div>
  );
}

/** Sep 2026 — real prospect pool round. Maps a `ScoutingTier` to `StatusPill`'s existing tone language rather than inventing new colours; Generational Talent/Superstar render `solid` so the two tiers Tyler explicitly said are worth "really going for" visually pop more than the rest. */
const TIER_TONE: Record<ScoutingTier, PillTone> = {
  "Generational Talent": "good",
  Superstar: "good",
  Elite: "good",
  Great: "info",
  Good: "info",
  Average: "warn",
  "Sub-par": "bad",
};

function ScoutingTierLabel({ tier }: { tier: ScoutingTier | undefined }) {
  if (!tier) return <span className="text-slate-500">?</span>;
  const solid = tier === "Generational Talent" || tier === "Superstar";
  return <StatusPill label={tier} tone={TIER_TONE[tier]} variant={solid ? "solid" : "soft"} />;
}

/** Round 99 — short form of each `ScoutingTier` for the board's fixed 84px Tier column, where the full
 * name (esp. "Generational Talent") won't fit. Same "abbreviate small, spell out big" precedent
 * `TIE_TYPE_ABBR`/`TieBadge` already established two rounds ago — the full name is always one click away
 * in the right-hand profile's own unabridged `ScoutingTierLabel`, and available here via `title`. */
const TIER_ABBR: Record<ScoutingTier, string> = {
  "Generational Talent": "Gen. Talent",
  Superstar: "Superstar",
  Elite: "Elite",
  Great: "Great",
  Good: "Good",
  Average: "Average",
  "Sub-par": "Sub-par",
};

function CompactTierLabel({ tier }: { tier: ScoutingTier | undefined }) {
  if (!tier) return <span className="text-slate-500">?</span>;
  const solid = tier === "Generational Talent" || tier === "Superstar";
  return (
    <span title={tier}>
      <StatusPill label={TIER_ABBR[tier]} tone={TIER_TONE[tier]} variant={solid ? "solid" : "soft"} />
    </span>
  );
}

/** Round 88 — abbreviated type label for the compact `TieBadge`; spelled out in full wherever space allows instead (see `ProspectProfile`'s own tie line). */
const TIE_TYPE_ABBR: Record<RealProspectTie["type"], string> = {
  "Father-Son": "F/S",
  Academy: "Academy",
  NGA: "NGA",
};

/**
 * Round 88 — real Father-Son/Academy/NGA recruitment-pathway tie, surfaced via
 * `primaryTieFor` (engine/draft.ts). Shown regardless of scouting progress —
 * unlike `ScoutingTierLabel`, a tie isn't something scouting reveals, it's a
 * fact about the prospect's eligibility that determines who can bid-match for
 * them at pick time (see `applyFatherSonRedirect` in useSaveStore.ts). Reuses
 * `StatusPill`'s "info" tone, the same one already used for the COMBINE pill,
 * so this reads as informational rather than competing with the tier pills'
 * good/warn/bad language.
 */
function TieBadge({ tie }: { tie: RealProspectTie }) {
  return <StatusPill label={`${TIE_TYPE_ABBR[tie.type]} → ${tie.club}`} tone="info" />;
}

/**
 * Round 70 — backlog #42. `ALL_PLAYERS` (the live established/drafted
 * population, imported directly the same way Contracts.tsx/TradePeriod.tsx
 * already do for their own real-data reads) is the comp pool, never
 * `window_.pool` — comping a prospect to another undrafted prospect on the
 * same board would be nonsensical. `playsLikeFor` is a pure, cheap-enough
 * O(pool) scan — recomputed on render, same "cheap enough, recompute rather
 * than cache" convention `trueProspectRank`/`scoutingTierFor` already use,
 * not memoized separately here.
 */
function PlaysLikeLine({ prospect }: { prospect: Player }) {
  const comp = playsLikeFor(prospect, ALL_PLAYERS);
  if (!comp) return <p className="text-sm text-slate-500">No comparable real player found yet.</p>;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="font-medium">{playerFullName(comp.player)}</span>
      <span className="text-xs text-slate-500">
        {comp.player.archetype} · {playsLikeConfidenceLabel(comp.distance)}
      </span>
    </div>
  );
}

/** Round 99 — extracted from `ProspectProfile`'s old inline header block so the cockpit's docked right
 * column can pin this part while the rest of the profile scrolls beneath it (Tyler's mockup: a fixed
 * name/meta header, a scrollable body, a fixed Draft-button footer). `ProspectProfile` still renders
 * this internally by default (see its own `hideHeader` prop) — every existing caller keeps seeing
 * exactly this same header in exactly the same spot, just via a shared component instead of inline JSX.
 * The button label shortens "View full profile" → "Full profile" to match the mockup's own wording —
 * same `onOpenProfile` handler, purely cosmetic. */
function ProspectHeader({
  prospect,
  revealedAttrs,
  scoutAccuracy,
  onOpenProfile,
}: {
  prospect: Player;
  revealedAttrs: RatedAttribute[];
  scoutAccuracy: number;
  onOpenProfile?: () => void;
}) {
  const band = scoutOvrBand(prospect, revealedAttrs.length, scoutAccuracy);
  const conf = scoutConfidence(prospect, revealedAttrs.length, scoutAccuracy);
  const width = Math.round((band.high - band.low) / 2);
  const tie = primaryTieFor(prospect);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="font-display text-lg italic">{playerFullName(prospect)}</div>
        {onOpenProfile && (
          <button onClick={onOpenProfile} className="shrink-0 rounded-lg bg-base-700 px-2.5 py-1 text-xs font-semibold hover:bg-base-600">
            Full profile
          </button>
        )}
      </div>
      <div className="text-xs text-slate-400">
        {prospect.archetype} · {prospect.homeState} · Age {prospect.Age} · {prospect.height}cm / {prospect.weight}kg
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--accT)" }}>
        ±{width} OVR read · {conf}% scouting confidence
      </div>
      {tie && (
        <div className="mt-2 flex items-center gap-1.5">
          <TieBadge tie={tie} />
          <span className="text-xs text-slate-500">
            {tie.type === "Father-Son" ? "Father-Son selection" : tie.type === "NGA" ? "Next Generation Academy" : "Academy"} tie to {tie.club} —
            that club can bid-match to secure this pick.
          </span>
        </div>
      )}
    </div>
  );
}

function ProspectProfile({
  prospect,
  pool,
  tier,
  revealedAttrs,
  budgetRemaining,
  scoutAccuracy,
  onScout,
  onDraft,
  onOpenProfile,
  hideHeader,
}: {
  prospect: Player;
  pool: Player[];
  tier: ScoutingTier | undefined;
  revealedAttrs: RatedAttribute[];
  budgetRemaining: number;
  /** Round 83 — resolved by the caller via `scoutAccuracyFor` against the club's assigned Talent Scout (or `DEFAULT_SCOUT_ACCURACY` if none). */
  scoutAccuracy: number;
  onScout: (attr: RatedAttribute) => void;
  onDraft?: () => void;
  /** Round 94 Part 2 — opens `ProspectProfileModal` for this same prospect. Omitted (not just falsy) when `ProspectProfile` is itself already being rendered AS that modal's own body — a "view full profile" button that reopens the modal it's already inside of would be nonsensical. */
  onOpenProfile?: () => void;
  /** Round 99 — true when the caller (the draft cockpit's docked right column) is rendering
   * `ProspectHeader` itself, pinned, outside this component's own scroll region. Every other caller
   * omits this and gets the header inline, exactly as before. */
  hideHeader?: boolean;
}) {
  const band = scoutOvrBand(prospect, revealedAttrs.length, scoutAccuracy);
  // Round 100 — Tyler's "Prompt 1" accent #5: the 3-up stat-tile row needs a Confidence figure alongside
  // Scout OVR/Potential; `scoutConfidence` is the same call `ProspectHeader`/the board's `ConfidenceBar`
  // already make for this prospect, just not previously surfaced here too.
  const conf = scoutConfidence(prospect, revealedAttrs.length, scoutAccuracy);
  const scouted = revealedAttrs.length > 0;

  return (
    <div className="space-y-4">
      {!hideHeader && <ProspectHeader prospect={prospect} revealedAttrs={revealedAttrs} scoutAccuracy={scoutAccuracy} onOpenProfile={onOpenProfile} />}

      <div>
        {/* Round 94 Part 2, Tyler: "a section which shows the 1 or 2 sentence player writeup summary."
            `scoutingSummaryFor` truncates the exact same text `scoutingReportFor` shows in full further
            down this panel — one source of truth, so the two can never disagree. */}
        <div className={`mb-1 ${LABEL_CLASS}`}>Summary</div>
        <p className="text-sm leading-relaxed text-slate-300">
          {scouted ? scoutingSummaryFor(prospect, tier) : "Scout at least one attribute to unlock a summary."}
        </p>
      </div>

      <div>
        <div className={`mb-1 ${LABEL_CLASS}`}>Scouting tier</div>
        {scouted ? <ScoutingTierLabel tier={tier} /> : <span className="text-sm text-slate-500">Unknown until scouted</span>}
      </div>

      {/* Round 100 — Tyler's "Prompt 1" accent #5: 3-up Scout OVR / Potential / Confidence tiles,
          replacing the old 2-col plain-text pair. Card background/border and the 8.5px/.7px-tracking
          mono label are the mockup's own literal values for this specific tile (its "all-caps labels"
          directive elsewhere in this round is 9.5px/1.1px — `LABEL_CLASS` — but this tile's own markup
          in the mockup is a deliberately smaller variant, kept as its own literal here rather than
          forced into that shared constant). Confidence's number reuses `confidenceColor` — same
          teal/yellow/red bands as the board's bar, so the colour language matches across the screen. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border p-2 text-center" style={{ borderColor: "rgba(255,255,255,.05)", background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)" }}>
          <div className="font-display text-lg font-bold leading-none">
            {band.low}-{band.high}
          </div>
          <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.7px] text-[#6f7c93]">Scout OVR</div>
        </div>
        <div className="rounded-lg border p-2 text-center" style={{ borderColor: "rgba(255,255,255,.05)", background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)" }}>
          <div className="font-display text-lg font-bold leading-none" style={revealedAttrs.length === 0 ? { color: "#4e5872" } : undefined}>
            {revealedAttrs.length === 0 ? "?" : potentialLetterGrade(prospect.POT)}
          </div>
          <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.7px] text-[#6f7c93]">Potential</div>
        </div>
        <div className="rounded-lg border p-2 text-center" style={{ borderColor: "rgba(255,255,255,.05)", background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)" }}>
          <div className="font-display text-lg font-bold leading-none" style={{ color: confidenceColor(conf) }}>
            {conf}%
          </div>
          <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.7px] text-[#6f7c93]">Confidence</div>
        </div>
      </div>

      {/* Round 100 — accent #5: "a yellow-tinted advisory box when scout budget is zero." Gated also on
          this prospect actually having unrevealed attributes left — once every headline attribute is
          already scouted, a budget-exhausted warning about THIS player has nothing left to warn about,
          even if the club's season-wide budget is spent (a judgment call, flagged in this round's
          addendum since Tyler's text didn't spell out that second condition). Round 119 — this genuinely
          IS a meaning/warning signal (per brief rule 5), so it now uses `MEANING_TOKENS.warn` instead of
          the old literal yellow, matching every other "watch out" surface app-wide. */}
      {budgetRemaining <= 0 && revealedAttrs.length < SCOUT_HEADLINE_ATTRIBUTES.length && (
        <div
          className="rounded-lg border p-2.5 text-[11.5px] leading-relaxed"
          style={{
            backgroundColor: `color-mix(in oklch, ${MEANING_TOKENS.warn} 12%, transparent)`,
            borderColor: `color-mix(in oklch, ${MEANING_TOKENS.warn} 30%, transparent)`,
            color: MEANING_TOKENS.warn,
          }}
        >
          Scout budget exhausted for this draft — {SCOUT_HEADLINE_ATTRIBUTES.length - revealedAttrs.length} of {SCOUT_HEADLINE_ATTRIBUTES.length}{" "}
          attributes will stay hidden for {playerFullName(prospect)}.
        </div>
      )}

      <div>
        <div className={`mb-2 flex items-center justify-between ${LABEL_CLASS}`}>
          <span>
            Attributes ({revealedAttrs.length}/{SCOUT_HEADLINE_ATTRIBUTES.length} revealed)
          </span>
          <span className="text-slate-500">Scout budget: {budgetRemaining} left</span>
        </div>
        {/* Round 100 — accent #5: attributes rebuilt as a 2-up grid of small cards, each carrying a
            compact "+1" chip in place of the old full-width "Scout +1" text button — same `onScout`
            wiring and budget-exhausted disabled state, purely a visual rebuild. */}
        <div className="grid grid-cols-2 gap-1">
          {SCOUT_HEADLINE_ATTRIBUTES.map((attr) => {
            const isRevealed = revealedAttrs.includes(attr);
            return (
              <div
                key={attr}
                className="flex items-center justify-between gap-1.5 rounded-md border px-2 py-1.5"
                style={{ borderColor: "rgba(255,255,255,.05)", background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)" }}
              >
                <span className="truncate text-[11.5px] font-medium text-[#c3ccdd]">{HEADLINE_ATTR_LABELS[attr]}</span>
                {isRevealed ? (
                  <span className="shrink-0 tabular-nums text-sm font-semibold">{prospect[attr]}</span>
                ) : (
                  <button
                    disabled={budgetRemaining <= 0}
                    onClick={() => onScout(attr)}
                    title={`Scout ${HEADLINE_ATTR_LABELS[attr]}`}
                    style={{ background: "rgba(255,255,255,.06)" }}
                    className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +1
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className={`mb-1.5 ${LABEL_CLASS}`}>Scouting report</div>
        {scouted ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{scoutingReportFor(prospect, tier)}</p>
        ) : (
          <p className="text-sm text-slate-500">Scout at least one attribute to unlock this prospect's scouting report.</p>
        )}
      </div>

      <div>
        <div className={`mb-1.5 ${LABEL_CLASS}`}>Plays like</div>
        {scouted ? <PlaysLikeLine prospect={prospect} /> : <p className="text-sm text-slate-500">Scout at least one attribute to unlock a comp.</p>}
      </div>

      <div>
        <div className={`mb-1.5 ${LABEL_CLASS}`}>Predicted draft range</div>
        {(() => {
          const range = predictedDraftRange(prospect, pool, scoutAccuracy);
          return (
            <div className="text-lg font-semibold tabular-nums" style={{ color: "var(--accT)" }}>
              {range.low === range.high ? `Pick ${range.low}` : `Picks ${range.low}-${range.high}`}
            </div>
          );
        })()}
      </div>

      <div>
        <div className={`mb-1.5 ${LABEL_CLASS}`}>Mock draft outlets</div>
        <div className="space-y-1 text-sm">
          {MOCK_OUTLETS.map((outlet: MockOutlet) => {
            const range = mockProjection(prospect, pool, outlet);
            return (
              <div key={outlet} className="flex justify-between">
                <span className="text-slate-400">{outlet}</span>
                <span className="tabular-nums">
                  Picks {range.low}-{range.high}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {onDraft && (
        // Round 100 — same gradient treatment as the cockpit's pinned Draft button (see `Draft()`'s
        // docked-column footer), so the button reads identically wherever this shared component renders
        // it — here, that's the "Full profile" modal.
        <button
          onClick={onDraft}
          className="w-full rounded-lg px-4 py-2 text-sm font-semibold shadow-lg"
          style={{ background: "var(--acc)", color: "var(--on)" }}
        >
          Draft {playerFullName(prospect)}
        </button>
      )}
    </div>
  );
}

/**
 * Round 94 Part 2 — Tyler: "our draft talent pool will also need a player profile which can be opened
 * and purveyed by the player when determining which players they want to scout and which players to
 * draft." A thin `<Modal>` wrapper around `ProspectProfile`'s own content (no `onOpenProfile`, and thus
 * no "view full profile" button rendered inside itself) — the same "give this kind of entity a genuine
 * modal, not just an inline panel" treatment `PlayerProfileModal.tsx` already gives a rostered player.
 * Deliberately does not duplicate any of that component's scouting-tier/band/report/comp/range/mock-
 * outlet logic — it IS that component, just framed by a `Modal` instead of the sidebar `<div className="card">`.
 */
function ProspectProfileModal({
  prospect,
  pool,
  tier,
  revealedAttrs,
  budgetRemaining,
  scoutAccuracy,
  onScout,
  onDraft,
  onClose,
}: {
  prospect: Player;
  pool: Player[];
  tier: ScoutingTier | undefined;
  revealedAttrs: RatedAttribute[];
  budgetRemaining: number;
  scoutAccuracy: number;
  onScout: (attr: RatedAttribute) => void;
  onDraft?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={playerFullName(prospect)} onClose={onClose}>
      <ProspectProfile
        prospect={prospect}
        pool={pool}
        tier={tier}
        revealedAttrs={revealedAttrs}
        budgetRemaining={budgetRemaining}
        scoutAccuracy={scoutAccuracy}
        onScout={onScout}
        onDraft={onDraft}
      />
    </Modal>
  );
}

// Round 97 — `TalentScoutPanel` (the [[Assistant Coaching System]] hiring UI from round 83) moved off
// this file entirely, onto the renamed "Talent Scouting" tab (Combine.tsx) per Tyler's explicit
// instruction: "The Talent Scout section of this draft page should move under what is currently called
// 'Combine'." See Combine.tsx for the (byte-identical) moved component.
