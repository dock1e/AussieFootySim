import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { MatchTeam } from "../engine/team";
import type { MatchEvent, BoxScoreLine } from "../engine/match";
import { computeDotPositions, ballDotPosition, GROUND_WIDTH, GROUND_HEIGHT, type DotPosition } from "../engine/ground";

/**
 * The signature feature — User Interface.md "Match simulation screen": a
 * top-down 2D ground, numbered dots, the ball visibly moving dot-to-dot.
 * Hand-rolled Canvas 2D per Engine.md's tech stack ("Only ~23 sprites on
 * screen... nowhere near the volume where PixiJS/WebGL earns its
 * complexity"). See src/engine/ground.ts for the honest explanation of what
 * "moves" here vs. what's a static formation slot.
 */
const HOME_COLOR = "#ff5a36"; // accent — matches Tailwind config's accent colour
const AWAY_COLOR = "#4b8fe0"; // info blue, a clear contrast against the accent
const DOT_RADIUS = 9;
const INVOLVED_DOT_RADIUS = 13;

function drawGround(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  // Turf
  ctx.fillStyle = "#0f2a1a";
  ctx.fillRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  const cx = GROUND_WIDTH / 2;
  const cy = GROUND_HEIGHT / 2;
  const rx = GROUND_WIDTH / 2 - 20;
  const ry = GROUND_HEIGHT / 2 - 20;

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;

  // Boundary oval
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Centre square + circle
  ctx.strokeRect(cx - 60, cy - 60, 120, 120);
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0, Math.PI * 2);
  ctx.stroke();

  // 50m arcs at each end (simplified as partial ellipses)
  ctx.beginPath();
  ctx.ellipse(20, cy, 130, ry * 0.85, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(GROUND_WIDTH - 20, cy, 130, ry * 0.85, 0, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();

  // Goal squares
  ctx.strokeRect(4, cy - 30, 24, 60);
  ctx.strokeRect(GROUND_WIDTH - 28, cy - 30, 24, 60);
}

function drawDot(ctx: CanvasRenderingContext2D, dot: DotPosition) {
  const radius = dot.involved ? INVOLVED_DOT_RADIUS : DOT_RADIUS;
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = dot.side === "home" ? HOME_COLOR : AWAY_COLOR;
  ctx.globalAlpha = dot.involved ? 1 : 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (dot.involved) {
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#0a0e14";
  ctx.font = `bold ${radius}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(dot.jumperNumber), dot.x, dot.y + 0.5);
}

function drawBall(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }) {
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y - 20, 7, 5, Math.PI / 4, 0, Math.PI * 2);
  ctx.fillStyle = "#f5d76e";
  ctx.fill();
  ctx.strokeStyle = "#8a6d1a";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export interface MatchCanvasProps {
  home: MatchTeam;
  away: MatchTeam;
  event: MatchEvent | null;
  /** Live-so-far box score, for the hover tooltip's statline — see hooks/useMatchPlayback.ts. */
  liveBoxScore?: Record<number, BoxScoreLine>;
}

export function MatchCanvas({ home, away, event, liveBoxScore }: MatchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dots, setDots] = useState<DotPosition[]>(() => computeDotPositions(home, away, null));
  const [hovered, setHovered] = useState<DotPosition | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setDots(computeDotPositions(home, away, event));
  }, [home, away, event]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawGround(ctx);
    for (const dot of dots) {
      if (!dot.involved) drawDot(ctx, dot);
    }
    // Draw involved dots last so they render on top of the rest.
    for (const dot of dots) {
      if (dot.involved) drawDot(ctx, dot);
    }
    drawBall(ctx, ballDotPosition(dots, event));
  }, [dots, event]);

  function handleMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GROUND_WIDTH / rect.width;
    const scaleY = GROUND_HEIGHT / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let closest: DotPosition | null = null;
    let closestDist = 18; // hover radius in virtual px
    for (const dot of dots) {
      const dist = Math.hypot(dot.x - mx, dot.y - my);
      if (dist < closestDist) {
        closest = dot;
        closestDist = dist;
      }
    }
    setHovered(closest);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const hoveredLine = hovered ? liveBoxScore?.[hovered.playerId] : undefined;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={GROUND_WIDTH}
        height={GROUND_HEIGHT}
        className="w-full rounded-card border border-base-600"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      />
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg border border-base-600 bg-base-900/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltipPos.x + 14, top: tooltipPos.y + 14 }}
        >
          <div className="font-semibold">
            #{hovered.jumperNumber} {hovered.lname}
          </div>
          <div className="text-slate-400">{hovered.side === "home" ? home.name : away.name}</div>
          {hoveredLine && (
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-300">
              <span>Disposals {hoveredLine.disposals}</span>
              <span>Marks {hoveredLine.marks}</span>
              <span>Tackles {hoveredLine.tackles}</span>
              <span>Goals {hoveredLine.goals}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
