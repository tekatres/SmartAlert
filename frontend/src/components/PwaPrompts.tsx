import { useEffect, useState } from "react";
import { usePwaInstall, usePwaUpdate } from "@/hooks/usePwa";

export function PwaPrompts() {
  const { canInstall, install, installed } = usePwaInstall();
  const { needRefresh, applyUpdate, dismiss } = usePwaUpdate();
  const [showInstall, setShowInstall] = useState(false);
  const [dismissedInstall, setDismissedInstall] = useState(
    () => sessionStorage.getItem("pwa-install-dismissed") === "1"
  );

  useEffect(() => {
    if (canInstall && !installed && !dismissedInstall) {
      const t = setTimeout(() => setShowInstall(true), 4000);
      return () => clearTimeout(t);
    }
  }, [canInstall, installed, dismissedInstall]);

  function dismissInstall() {
    setShowInstall(false);
    setDismissedInstall(true);
    sessionStorage.setItem("pwa-install-dismissed", "1");
  }

  return (
    <>
      {showInstall && (
        <div className="fixed bottom-4 left-4 z-40 max-w-sm rounded-lg border border-white/10 bg-bg-elevated/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/20 text-brand-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Instala la app</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Acceso rápido y notificaciones en tu pantalla de inicio.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={async () => {
                    const ok = await install();
                    if (ok) setShowInstall(false);
                  }}
                  className="btn-primary text-xs"
                >
                  Instalar
                </button>
                <button onClick={dismissInstall} className="btn-ghost text-xs">
                  Más tarde
                </button>
              </div>
            </div>
            <button
              onClick={dismissInstall}
              className="rounded p-1 text-slate-500 hover:bg-white/5"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {needRefresh && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-brand-500/30 bg-brand-500/10 p-4 shadow-xl backdrop-blur">
          <p className="text-sm font-semibold text-brand-300">Nueva versión disponible</p>
          <p className="mt-0.5 text-xs text-slate-300">
            Recarga para obtener las últimas mejoras.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={applyUpdate} className="btn-primary text-xs">
              Actualizar
            </button>
            <button onClick={dismiss} className="btn-ghost text-xs">
              Después
            </button>
          </div>
        </div>
      )}
    </>
  );
}
