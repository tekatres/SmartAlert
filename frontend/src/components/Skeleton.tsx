import { clsx } from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "animate-pulse rounded-md bg-white/[0.06]",
        className
      )}
    />
  );
}

export function AlertCardSkeleton() {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
        </div>
        <div className="flex flex-col items-end">
          <Skeleton className="h-7 w-12" />
          <Skeleton className="mt-1 h-1.5 w-16 rounded-full" />
        </div>
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-3/4" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-2 w-14" />
            <Skeleton className="mt-1.5 h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-16 w-full rounded-lg" />
      <div className="mt-4 flex justify-between">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </div>
  );
}

export function AlertListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <AlertCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="card p-4">
      <Skeleton className="h-2 w-20" />
      <Skeleton className="mt-2 h-7 w-16" />
      <Skeleton className="mt-1 h-2 w-24" />
    </div>
  );
}
