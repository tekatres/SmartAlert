import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/services/auth";
import { useToast } from "@/components/Toaster";
import { clsx } from "clsx";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, authReady } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authReady && user) navigate("/", { replace: true });
  }, [authReady, user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
        toast({ tone: "success", title: "Bienvenido de vuelta" });
      } else {
        await signUpWithEmail(email, password);
        toast({ tone: "success", title: "Cuenta creada", description: "Te hemos enviado un email de verificación." });
      }
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(prettyError(err?.code) || err?.message || "Error de autenticación");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Error con Google");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-bg-base via-bg-base to-bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-400 shadow-glow">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 11l3-5 3 2 3-6 3 4"
                stroke="#0a0a0f"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold">Smart Alerts AI</h1>
          <p className="mt-1 text-sm text-slate-400">
            Alertas inteligentes, explicadas en lenguaje claro.
          </p>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex rounded-lg bg-white/5 p-1 text-sm">
            <button
              className={clsx(
                "flex-1 rounded-md py-1.5 font-medium transition-colors",
                mode === "signin" ? "bg-bg-elevated text-slate-100" : "text-slate-400"
              )}
              onClick={() => setMode("signin")}
              type="button"
            >
              Entrar
            </button>
            <button
              className={clsx(
                "flex-1 rounded-md py-1.5 font-medium transition-colors",
                mode === "signup" ? "bg-bg-elevated text-slate-100" : "text-slate-400"
              )}
              onClick={() => setMode("signup")}
              type="button"
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Email</label>
              <input
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Contraseña</label>
              <input
                type="password"
                required
                minLength={6}
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full disabled:opacity-60"
            >
              {busy ? "Procesando…" : mode === "signin" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
            <div className="h-px flex-1 bg-white/5" />
            <span>o</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={busy}
            className="btn w-full border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 disabled:opacity-60"
          >
            <GoogleIcon />
            Continuar con Google
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Al continuar aceptas los términos y la política de privacidad.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8L6.3 33.3C9.6 39.9 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.9 36 44 30.5 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

function prettyError(code?: string): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    "auth/invalid-email": "Email no válido",
    "auth/user-not-found": "Usuario no encontrado",
    "auth/wrong-password": "Contraseña incorrecta",
    "auth/email-already-in-use": "Este email ya está registrado",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres",
    "auth/popup-closed-by-user": "Ventana cerrada antes de completar",
  };
  return map[code] || null;
}
