import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, startAfter, Timestamp } from "firebase/firestore";
import { db } from "@/services/firebase";
import { AlertDoc } from "@/types";
import { AlertCard } from "@/components/AlertCard";
import { AlertListSkeleton } from "@/components/Skeleton";
import { Filters } from "@/components/Filters";
import { useAppStore } from "@/store/useAppStore";

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const filterType = useAppStore((s) => s.filterType);
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<Timestamp | null>(null);
  const [hasMore, setHasMore] = useState(true);

  async function loadPage(reset = false) {
    if (reset) {
      setLoading(true);
      setCursor(null);
    } else {
      setLoadingMore(true);
    }
    const constraints: any[] = [orderBy("created_at", "desc"), limit(PAGE_SIZE)];
    if (!reset && cursor) constraints.push(startAfter(cursor));
    const snap = await getDocs(query(collection(db, "alerts"), ...constraints));
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AlertDoc[];
    setAlerts((prev) => (reset ? items : [...prev, ...items]));
    if (snap.docs.length > 0) {
      setCursor(snap.docs[snap.docs.length - 1].get("created_at") as Timestamp);
    }
    setHasMore(snap.docs.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }

  useEffect(() => {
    loadPage(true);
  }, []);

  const filtered = alerts.filter((a) => {
    if (filterType !== "all" && a.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !a.symbol.toLowerCase().includes(q) &&
        !a.name.toLowerCase().includes(q) &&
        !a.title.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Historial</h1>
        <p className="text-sm text-slate-400">
          Todas las alertas generadas, ordenadas de más reciente a más antigua.
        </p>
      </div>

      <Filters />

      {loading ? (
        <AlertListSkeleton count={6} />
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400">Sin resultados para los filtros actuales.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => loadPage(false)}
                disabled={loadingMore}
                className="btn-ghost"
              >
                {loadingMore ? "Cargando…" : "Cargar más"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
