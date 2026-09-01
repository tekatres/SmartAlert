import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ReactNode } from "react";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, authReady } = useAuth();
  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Cargando…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
