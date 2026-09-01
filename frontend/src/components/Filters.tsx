import { clsx } from "clsx";
import { AlertType } from "@/types";

const FILTERS: { value: AlertType | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "price_surge", label: "Subidas" },
  { value: "price_dump", label: "Caídas" },
  { value: "volume_spike", label: "Volumen" },
  { value: "breakout", label: "Breakouts" },
];

export function Filters() {
  const filterType = useAppStoreFilter();
  const setFilterType = useAppStoreSetFilter();
  const searchQuery = useAppStoreSearch();
  const setSearchQuery = useAppStoreSetSearch();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterType(f.value)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              filterType === f.value
                ? "bg-brand-600 text-white"
                : "bg-white/5 text-slate-300 hover:bg-white/10"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        className="input sm:max-w-xs"
        placeholder="Buscar por símbolo o nombre…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
    </div>
  );
}

import { useAppStore } from "@/store/useAppStore";
const useAppStoreFilter = () => useAppStore((s) => s.filterType);
const useAppStoreSetFilter = () => useAppStore((s) => s.setFilterType);
const useAppStoreSearch = () => useAppStore((s) => s.searchQuery);
const useAppStoreSetSearch = () => useAppStore((s) => s.setSearchQuery);
