import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { signOut } from "@/services/auth";
import { useAppStore } from "@/store/useAppStore";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Toaster, useToast } from "@/components/Toaster";
import { PwaPrompts } from "@/components/PwaPrompts";
import { BottomNav } from "@/components/BottomNav";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { useState } from "react";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/history", label: "Historial" },
  { to: "/settings", label: "Ajustes" },
];

export function Layout() {
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();
  const { enable } = usePushNotifications();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await signOut();
    toast({ tone: "info", title: "Sesión cerrada" });
    navigate("/login");
  }

  async function handleEnablePush() {
    const ok = await enable();
    if (ok) {
      toast({ tone: "success", title: "Notificaciones activadas", description: "Recibirás las alertas al instante." });
    } else {
      toast({ tone: "warning", title: "Permiso denegado", description: "Puedes activarlo más tarde desde los ajustes del navegador." });
    }
  }

  return (
    <div className="min-h-full pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-bg-base/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
            <span className="text-sm font-semibold tracking-tight">
              Smart Alerts <span className="text-brand-400">AI</span>
            </span>
          </Link>

          <nav className="hidden gap-1 sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  clsx(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-white/5 text-slate-100"
                      : "text-slate-400 hover:text-slate-200"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <BalanceWidget />
            <button onClick={handleEnablePush} className="btn-ghost hidden sm:inline-flex">
              <BellIcon />
              <span className="hidden md:inline">Activar notificaciones</span>
            </button>
            <ThemeToggle />
            {user && <UserMenu onLogout={handleLogout} open={menuOpen} setOpen={setMenuOpen} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:pb-6">
        <Outlet />
      </main>

      <BottomNav />
      <Toaster />
      <PwaPrompts />
    </div>
  );
}

function UserMenu({
  open,
  setOpen,
  onLogout,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onLogout: () => void;
}) {
  const user = useAppStore((s) => s.user)!;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-white/5"
        aria-label="Menú de usuario"
      >
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            className="h-8 w-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold">
            {(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-56 rounded-lg border border-white/10 bg-bg-elevated p-2 shadow-xl">
            <div className="border-b border-white/5 px-2 py-2">
              <p className="truncate text-sm font-medium">{user.displayName || user.email}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5"
            >
              Ajustes
            </Link>
            <Link
              to="/premium"
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-1.5 text-sm text-brand-300 hover:bg-white/5"
            >
              ✨ Mejorar a Premium
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-500/10"
            >
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="btn-ghost h-9 w-9 px-0"
      aria-label="Cambiar tema"
      title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 004 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BalanceWidget() {
  const { balance, netPnl } = usePaperTrading();
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-slate-900 border border-slate-700/80 px-3 py-1 font-mono text-xs shadow-sm">
      <span className="text-[10px] text-slate-400 font-sans uppercase font-bold">Saldo:</span>
      <span className="font-bold text-emerald-400">${balance.toFixed(2)}</span>
      <span className={clsx("text-[10px] font-bold", netPnl >= 0 ? "text-emerald-300" : "text-rose-400")}>
        ({netPnl >= 0 ? "+" : ""}${netPnl.toFixed(0)})
      </span>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-cyan-400 shadow-glow">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M2 11l3-5 3 2 3-6 3 4"
          stroke="#0a0a0f"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
