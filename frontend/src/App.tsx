import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import SettingsPage from "@/pages/SettingsPage";
import HistoryPage from "@/pages/HistoryPage";
import AlertDetailPage from "@/pages/AlertDetailPage";
import SignalDetailPage from "@/pages/SignalDetailPage";
import OnboardingPage from "@/pages/OnboardingPage";
import PremiumPage from "@/pages/PremiumPage";

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/alerts/:id" element={<AlertDetailPage />} />
          <Route path="/signals/:id" element={<SignalDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/premium" element={<PremiumPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
