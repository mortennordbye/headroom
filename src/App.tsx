import { lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { FinanceProvider, useFinanceSettings } from './context/FinanceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import UpdatePrompt from './components/UpdatePrompt';
import CatchupPrompt from './components/CatchupPrompt';
import GainReviewPrompt from './components/GainReviewPrompt';
import LoginScreen from './components/LoginScreen';
import Layout from './components/Layout';

// Code-split per route: each page bundle is fetched only when navigated to.
const pageImports = [
  () => import('./pages/DashboardPage'),
  () => import('./pages/BudgetPage'),
  () => import('./pages/AssetPage'),
  () => import('./pages/SalaryPage'),
  () => import('./pages/BoligPage'),
  () => import('./pages/ForecastPage'),
  () => import('./pages/PensionPage'),
  () => import('./pages/EmployerCostPage'),
  () => import('./pages/YearReviewPage'),
  () => import('./pages/SettingsPage'),
] as const;
const [DashboardPage, BudgetPage, AssetPage, SalaryPage, BoligPage, ForecastPage, PensionPage, EmployerCostPage, YearReviewPage, SettingsPage] =
  pageImports.map(load => lazy(load));

// Warm every route once the app is idle, one chunk per idle slot, so the first
// visit to a tab doesn't pay for fetching and evaluating its bundle. Safari has no
// requestIdleCallback, so its fallback must be short: at one second per chunk the
// last tabs on an iPhone could stay cold for ten seconds. The service
// worker already caches the files; this also gets them parsed and run ahead of time.
function usePreloadRoutes() {
  useEffect(() => {
    const idle = (cb: () => void) =>
      typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 50);
    let cancelled = false;
    const queue = [...pageImports];
    const next = () => {
      const load = queue.shift();
      if (cancelled || !load) return;
      load().catch(() => {}).finally(() => idle(next));
    };
    idle(next);
    return () => { cancelled = true; };
  }, []);
}

// Gates the whole app behind the login screen when the server requires a password
// and there's no valid session. Must live inside the provider to read auth state.
function AuthGate({ children }: { children: React.ReactNode }) {
  const { authRequired } = useFinanceSettings();
  if (authRequired) return <LoginScreen />;
  return <>{children}</>;
}

function App() {
  usePreloadRoutes();
  return (
    <FinanceProvider>
      <AuthGate>
        <ErrorBoundary>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="budget" element={<BudgetPage />} />
                {/* Dashboard moved from /overview to the index; keep the old path working. */}
                <Route path="overview" element={<Navigate to="/" replace />} />
                <Route path="assets" element={<AssetPage />} />
                <Route path="bolig" element={<BoligPage />} />
                {/* Loan page became the Bolig hub; keep the old path working. */}
                <Route path="loan" element={<Navigate to="/bolig" replace />} />
                <Route path="salary" element={<SalaryPage />} />
                <Route path="forecast" element={<ForecastPage />} />
                <Route path="pension" element={<PensionPage />} />
                <Route path="employer-cost" element={<EmployerCostPage />} />
                <Route path="year" element={<YearReviewPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </AuthGate>
      <UpdatePrompt />
      <CatchupPrompt />
      <GainReviewPrompt />
    </FinanceProvider>
  );
}

export default App;
