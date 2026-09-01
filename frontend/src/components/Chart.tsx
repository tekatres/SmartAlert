// Lightweight, dependency-free SVG sparkline + bar chart components.
import { clsx } from "clsx";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 320,
  height = 80,
  stroke = "#6366f1",
  fill = "rgba(99,102,241,0.15)",
  className,
}: SparklineProps) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });
  const pathD = points
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(" ");
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={clsx("w-full", className)}
      preserveAspectRatio="none"
    >
      <path d={areaD} fill={fill} />
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3} fill={stroke} />
    </svg>
  );
}

interface BarsProps {
  values: number[];
  width?: number;
  height?: number;
  positiveColor?: string;
  negativeColor?: string;
  className?: string;
}

export function Bars({
  values,
  width = 320,
  height = 80,
  positiveColor = "#22c55e",
  negativeColor = "#ef4444",
  className,
}: BarsProps) {
  if (!values.length) return null;
  const max = Math.max(...values.map((v) => Math.abs(v))) || 1;
  const barW = width / values.length;
  const mid = height / 2;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={clsx("w-full", className)}>
      <line
        x1={0}
        x2={width}
        y1={mid}
        y2={mid}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={1}
      />
      {values.map((v, i) => {
        const h = (Math.abs(v) / max) * (mid - 4);
        const x = i * barW + barW * 0.15;
        const w = barW * 0.7;
        const y = v >= 0 ? mid - h : mid;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={1}
            fill={v >= 0 ? positiveColor : negativeColor}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
