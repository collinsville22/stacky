"use client";

import { useMemo } from "react";

interface PriceChartProps {
  data: { time: number; price: number }[];
  mode?: "btc" | "share";
  refLine?: number;
  refLineLabel?: string;
  width?: number;
  height?: number;
}

function catmullRomPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;
  }

  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  return d;
}

function formatBtcPrice(p: number): string {
  return `$${p.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function PriceChart({ data, mode = "share", refLine, refLineLabel, width = 700, height = 260 }: PriceChartProps) {
  const padding = { top: 16, right: 62, bottom: 28, left: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const chart = useMemo(() => {
    if (data.length < 2) return null;

    const prices = data.map((d) => d.price);
    let min = Math.min(...prices);
    let max = Math.max(...prices);

    if (refLine != null) {
      min = Math.min(min, refLine);
      max = Math.max(max, refLine);
    }

    if (mode === "share") {
      const range = Math.max(max - min, 0.08);
      const padY = range * 0.12;
      min = Math.max(0, min - padY);
      max = Math.min(1, max + padY);
    } else {
      const range = Math.max(max - min, 20);
      const padY = range * 0.15;
      min = min - padY;
      max = max + padY;
    }

    const yRange = max - min || (mode === "share" ? 0.1 : 20);
    const yMin = min;
    const yMax = max;

    const tMin = data[0].time;
    const tMax = data[data.length - 1].time;
    const tRange = tMax - tMin || 1;

    const toX = (t: number) => padding.left + ((t - tMin) / tRange) * chartW;
    const toY = (p: number) => padding.top + (1 - (p - yMin) / yRange) * chartH;

    const points = data.map((d) => ({ x: toX(d.time), y: toY(d.price) }));
    const linePath = catmullRomPath(points);

    const bottomY = padding.top + chartH;
    const lastPt = points[points.length - 1];
    const firstPt = points[0];
    const areaPath = `${linePath} L${lastPt.x.toFixed(1)},${bottomY} L${firstPt.x.toFixed(1)},${bottomY} Z`;

    const lastPrice = data[data.length - 1].price;
    const firstPrice = data[0].price;
    const isUp = lastPrice >= firstPrice;

    let refY: number | null = null;
    if (refLine != null && refLine >= yMin && refLine <= yMax) {
      refY = toY(refLine);
    } else if (mode === "share" && yMin < 0.5 && yMax > 0.5) {
      refY = toY(0.5);
    }

    const priceLabels: { y: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const p = yMin + (yRange * i) / 4;
      priceLabels.push({
        y: toY(p),
        label: mode === "btc" ? formatBtcPrice(p) : `${(p * 100).toFixed(0)}c`,
      });
    }

    const timeLabels: { x: number; label: string }[] = [];
    const steps = Math.min(5, data.length);
    for (let i = 0; i <= steps; i++) {
      const t = tMin + (tRange * i) / steps;
      const d = new Date(t);
      timeLabels.push({
        x: toX(t),
        label: `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
      });
    }

    const lastLabel = mode === "btc"
      ? formatBtcPrice(lastPrice)
      : `${(lastPrice * 100).toFixed(0)}c`;

    return { linePath, areaPath, last: lastPt, lastPrice, lastLabel, isUp, refY, priceLabels, timeLabels };
  }, [data, mode, refLine, chartW, chartH, padding.left, padding.top, padding.right, padding.bottom]);

  if (!chart) {
    return (
      <div className="flex items-center justify-center h-[260px] text-fg-3 text-[13px] font-mono">
        Waiting for price data...
      </div>
    );
  }

  const lineColor = chart.isUp ? "#5CBD7B" : "#D45B5B";
  const areaColor = chart.isUp ? "rgba(92, 189, 123, 0.15)" : "rgba(212, 91, 91, 0.15)";
  const tagWidth = mode === "btc" ? 60 : 46;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ maxHeight: height }}
      preserveAspectRatio="xMidYMid meet"
    >
      {chart.priceLabels.map((l, i) => (
        <g key={i}>
          <line
            x1={padding.left} x2={width - padding.right}
            y1={l.y} y2={l.y}
            stroke="#332F2B" strokeWidth="1" strokeDasharray="3,3"
          />
          <text
            x={width - padding.right + 6} y={l.y + 4}
            fill="#ADA79E" fontSize="10" fontFamily="'IBM Plex Mono', monospace"
          >
            {l.label}
          </text>
        </g>
      ))}

      {chart.refY != null && (
        <g>
          <line
            x1={padding.left} x2={width - padding.right}
            y1={chart.refY} y2={chart.refY}
            stroke="#C9915A" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7"
          />
          <text
            x={padding.left + 4} y={chart.refY - 5}
            fill="#C9915A" fontSize="9" fontFamily="'IBM Plex Mono', monospace" fontWeight="bold"
          >
            {refLineLabel || (mode === "btc" ? "STRIKE" : "50c")}
          </text>
        </g>
      )}

      {chart.timeLabels.map((l, i) => (
        <text
          key={i} x={l.x} y={height - 4}
          fill="#ADA79E" fontSize="9" fontFamily="'IBM Plex Mono', monospace" textAnchor="middle"
        >
          {l.label}
        </text>
      ))}

      <path d={chart.areaPath} fill={areaColor} />

      <path d={chart.linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      <g>
        <circle cx={chart.last.x} cy={chart.last.y} r="3.5" fill={lineColor} />
        <circle cx={chart.last.x} cy={chart.last.y} r="7" fill={lineColor} opacity="0.15">
          <animate attributeName="r" values="7;12;7" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.15;0;0.15" dur="1.5s" repeatCount="indefinite" />
        </circle>
      </g>

      <g>
        <rect
          x={width - padding.right + 2} y={chart.last.y - 9}
          width={tagWidth} height="18" rx="0"
          fill={lineColor}
        />
        <text
          x={width - padding.right + 2 + tagWidth / 2} y={chart.last.y + 4}
          fill="#121110" fontSize="10" fontFamily="'IBM Plex Mono', monospace"
          fontWeight="bold" textAnchor="middle"
        >
          {chart.lastLabel}
        </text>
      </g>
    </svg>
  );
}
