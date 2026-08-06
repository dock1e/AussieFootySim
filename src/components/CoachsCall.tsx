import type { GameStyle } from "../engine/tactics";

/**
 * Quarter-time Coach's Call — Engine.md "Match-day flow" step 4: at the end
 * of Q1/Q2/Q3 the sim stops automatically and presents a short prompt with
 * narrative-flavoured options, "reusing the reference site's exact pattern:
 * e.g. 'Push harder' / 'Slow the pace' / 'Focus on defence' / 'Focus on
 * attack' / 'Trust the players,' each with flavour text and a small,
 * transparent stat effect." This is also, per the same doc, "the only point
 * the team-wide game style can be changed" mid-match — so rather than invent
 * a parallel mini-system, each option here maps 1:1 onto one of the 6 real
 * `GameStyle` values already implemented in tactics.ts, with a flavour label
 * over the *same* real effect text (no new numbers). Wired in LiveMatch.tsx
 * via `setGameStyle()` on the in-progress match.
 */
const COACHS_CALL_OPTIONS: { style: GameStyle; label: string; blurb: string }[] = [
  { style: "Balanced", label: "Trust the Players", blurb: "No bias — keep playing your natural game." },
  {
    style: "Defensive Flood",
    label: "Focus on Defence",
    blurb: "More intercepts and spoils, fewer forward entries. Lower-scoring both ways — good for protecting a lead.",
  },
  {
    style: "Spread the Ground",
    label: "Run & Carry",
    blurb: "More uncontested chains and run-and-carry footy. Higher-scoring and free-flowing, but costs more fatigue.",
  },
  {
    style: "Chip & Mark",
    label: "Slow the Pace",
    blurb: "Better disposal efficiency, fewer clangers, fewer inside-50s. Grinds the scoreline down.",
  },
  {
    style: "Attack the Middle",
    label: "Push Harder",
    blurb: "More clearances and inside-50s off the back of them. High risk, high reward — needs a strong midfield to pay off.",
  },
  {
    style: "Forward Press",
    label: "Focus on Attack",
    blurb: "More turnovers forced inside the opponent's defensive 50, more inside-50s of your own. Risky if the press gets broken.",
  },
];

export interface CoachsCallProps {
  /** Which quarter just finished — the prompt is headed "End of Q1" etc. */
  quarterJustFinished: 1 | 2 | 3;
  currentStyle: GameStyle;
  onChoose: (style: GameStyle) => void;
}

export function CoachsCall({ quarterJustFinished, currentStyle, onChoose }: CoachsCallProps) {
  return (
    <div className="card">
      <div className="mb-1 font-display text-xl italic">Coach's Call</div>
      <div className="mb-3 text-xs text-slate-400">
        End of Q{quarterJustFinished}. Set your game style for the rest of the match — this is the only point it
        can change once you've kicked off.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {COACHS_CALL_OPTIONS.map((opt) => {
          const isCurrent = opt.style === currentStyle;
          return (
            <button
              key={opt.style}
              onClick={() => onChoose(opt.style)}
              className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                isCurrent ? "border-accent bg-accent/10" : "border-base-600 bg-base-900 hover:bg-base-800"
              }`}
            >
              <div className="mb-0.5 font-semibold text-slate-200">
                {opt.label}
                {isCurrent && <span className="ml-1 font-normal text-accent-light">(current)</span>}
              </div>
              <div className="text-slate-400">{opt.blurb}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
