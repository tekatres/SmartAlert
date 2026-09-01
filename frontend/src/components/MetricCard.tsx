interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "high" | "medium" | "low";
}

const TONE = {
  default: "text-slate-100 dark:text-slate-100",
  high: "text-score-high",
  medium: "text-score-medium",
  low: "text-score-low",
} as const;

export function MetricCard({ label, value, hint, tone = "default" }: MetricCardProps) {
  return (
    <div className="card p-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${TONE[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="card p-4">
      <div className="h-2 w-20 animate-pulse rounded-md bg-white/[0.06]" />
      <div className="mt-2 h-7 w-16 animate-pulse rounded-md bg-white/[0.06]" />
      <div className="mt-1 h-2 w-24 animate-pulse rounded-md bg-white/[0.06]" />
    </div>
  );
}
