import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

interface Props {
  symbol: string; // e.g. "BTC", "ETH", "SOL"
  interval?: "15" | "60" | "240" | "D";
  height?: number;
}

export function TradingViewChart({
  symbol,
  interval = "60",
  height = 400,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeInterval, setActiveInterval] = useState(interval);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (typeof window !== "undefined" && (window as any).TradingView) {
        const tvSymbol = `BINANCE:${symbol.toUpperCase()}USDT.P`;
        new (window as any).TradingView.widget({
          autosize: true,
          width: "100%",
          height: "100%",
          symbol: tvSymbol,
          interval: activeInterval,
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "es",
          toolbar_bg: "#0f172a",
          enable_publishing: false,
          allow_symbol_change: true,
          container_id: containerRef.current?.id,
          hide_side_toolbar: false,
          studies: ["RSI@tv-basicstudies", "MASimple@tv-basicstudies"],
        });
      }
    };

    containerRef.current.appendChild(script);
  }, [symbol, activeInterval, isFullscreen]);

  const toggleFullscreen = () => {
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const uniqueId = `tv_chart_${symbol.toLowerCase()}_${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        "flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-2xl transition-all",
        isFullscreen ? "fixed inset-0 z-50 rounded-none border-none p-4" : "w-full"
      )}
      style={{ height: isFullscreen ? "100vh" : `${height}px` }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="font-black text-xs text-slate-200 uppercase tracking-wide">
            📈 {symbol} / USDT (Futuros)
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-0.5 border border-slate-800">
            {(["15", "60", "240"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setActiveInterval(tf)}
                className={clsx(
                  "rounded px-2 py-0.5 text-[10px] font-bold transition-colors",
                  activeInterval === tf
                    ? "bg-emerald-500 text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {tf === "15" ? "15m" : tf === "60" ? "1h" : "4h"}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-white/10 transition-colors"
          title="Pantalla Completa"
        >
          {isFullscreen ? "↙ Salir Pantalla Completa" : "⤢ Pantalla Completa"}
        </button>
      </div>

      <div className="flex-1 w-full relative">
        <div id={uniqueId} ref={containerRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}
