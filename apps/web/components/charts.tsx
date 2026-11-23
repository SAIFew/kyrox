"use client";

import { useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { ChartPoint } from "../lib/market-types";
import { formatPrice } from "../lib/format";

function pathFor(values: number[], width: number, height: number, pad = 2): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({
  points,
  tone = "up",
  width = 132,
  height = 40,
}: {
  points: readonly number[];
  tone?: "up" | "down" | "flat";
  width?: number;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const path = pathFor([...points], width, height);
  const color = tone === "up" ? "#7cf0c1" : tone === "down" ? "#ff8f8f" : "#8b97a8";
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

const BUCKETS = 6;

export function PriceChart({
  points,
  height = 320,
  tone = "up",
}: {
  points: readonly ChartPoint[];
  height?: number;
  tone?: "up" | "down" | "flat";
}) {
  const id = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 1_000;
  const innerHeight = 300;

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((point) => point.p);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const xy = points.map((point, index) => ({
      x: (index / (points.length - 1)) * width,
      y: innerHeight - 14 - ((point.p - min) / span) * (innerHeight - 28),
      point,
    }));
    const line = xy
      .map(
        (entry, index) => `${index === 0 ? "M" : "L"}${entry.x.toFixed(2)},${entry.y.toFixed(2)}`,
      )
      .join(" ");
    return { xy, line, min, max };
  }, [points]);

  if (geometry === null) {
    return (
      <div className="chart-empty" style={{ height }}>
        No price history is available for this market.
      </div>
    );
  }

  const color = tone === "up" ? "#7cf0c1" : tone === "down" ? "#ff8f8f" : "#8b97a8";
  const area = `${geometry.line} L${width},${innerHeight} L0,${innerHeight} Z`;
  const active = hover === null ? null : (geometry.xy[hover] ?? null);
  const first = points[0];
  const last = points[points.length - 1];

  function onMove(event: ReactMouseEvent<HTMLDivElement>) {
    const target = container.current;
    if (target === null) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (points.length - 1)));
  }

  const span = (last?.t ?? 0) - (first?.t ?? 0);
  const labelFor = (timestamp: number, variant: "time" | "date") =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      ...(variant === "time"
        ? span > 129_600
          ? {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }
          : { hour: "2-digit", minute: "2-digit", hour12: false }
        : { month: "short", day: "numeric" }),
    }).format(new Date(timestamp * 1_000));

  return (
    <div
      className="price-chart"
      ref={container}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{ height }}
    >
      <div className="chart-grid" aria-hidden="true">
        {Array.from({ length: BUCKETS }, (_, index) => (
          <span key={index} style={{ top: `${(index / (BUCKETS - 1)) * 100}%` }} />
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${innerHeight}`}
        preserveAspectRatio="none"
        className="chart-svg"
        role="img"
        aria-label="Reference price history"
      >
        <defs>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="70%" stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#area-${id})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {active !== null && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={0}
              y2={innerHeight}
              stroke="rgba(233,237,244,0.22)"
              strokeDasharray="4 5"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={active.x} cy={active.y} r="5" fill={color} />
            <circle cx={active.x} cy={active.y} r="10" fill={color} opacity="0.16" />
          </>
        )}
      </svg>
      <div className="chart-axis chart-axis-y" aria-hidden="true">
        <span>{formatPrice(geometry.max)}</span>
        <span>{formatPrice((geometry.max + geometry.min) / 2)}</span>
        <span>{formatPrice(geometry.min)}</span>
      </div>
      <div className="chart-axis chart-axis-x" aria-hidden="true">
        <span>{labelFor(first?.t ?? 0, "time")} UTC</span>
        <span>{labelFor(((first?.t ?? 0) + (last?.t ?? 0)) / 2, "time")} UTC</span>
        <span>{labelFor(last?.t ?? 0, "time")} UTC</span>
      </div>
      {active !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(active.x / width) * 100}%`,
            top: `${(active.y / innerHeight) * 100}%`,
          }}
        >
          <strong>{formatPrice(active.point.p)}</strong>
          <span>
            {labelFor(active.point.t, "date")} · {labelFor(active.point.t, "time")} UTC
          </span>
        </div>
      )}
    </div>
  );
}
