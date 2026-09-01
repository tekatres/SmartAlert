import { Component, ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught", error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="card w-full max-w-md p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-2xl text-rose-300">
              !
            </div>
            <h1 className="text-lg font-semibold">Algo se ha roto</h1>
            <p className="mt-1 text-sm text-slate-400">
              No te preocupes, tu cuenta y tus datos están a salvo.
            </p>
            {this.state.error && (
              <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-white/[0.03] p-3 text-left text-xs text-slate-400">
                {this.state.error.message}
              </pre>
            )}
            <div className="mt-6 flex justify-center gap-2">
              <button onClick={this.reset} className="btn-primary">
                Reintentar
              </button>
              <Link to="/" className="btn-ghost">
                Ir al inicio
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
