import { NavLink, useLocation } from "react-router-dom";
import { clsx } from "clsx";

const NAV = [
  { to: "/", label: "Inicio", icon: HomeIcon },
  { to: "/history", label: "Historial", icon: ClockIcon },
  { to: "/settings", label: "Ajustes", icon: GearIcon },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-bg-base/95 backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-md items-stretch">
        {NAV.map((item) => {
          const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={clsx(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-brand-400" : "text-slate-500"
              )}
            >
              <Icon active={active} />
              {item.label}
            </NavLink>
          );
        })}
      </div>
      {/* safe area for iOS PWA */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-3v-7H8v7H5a2 2 0 01-2-2v-9z"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} strokeLinecap="round" />
    </svg>
  );
}

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={active ? 2.2 : 1.6} />
      <path
        d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"
        stroke="currentColor"
        strokeWidth={active ? 1.4 : 1.1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
