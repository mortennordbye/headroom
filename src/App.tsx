import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { FinanceProvider, useFinance, useFinanceSettings } from './context/FinanceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import UpdatePrompt from './components/UpdatePrompt';
import CatchupPrompt from './components/CatchupPrompt';
import GainReviewPrompt from './components/GainReviewPrompt';
import LoginScreen from './components/LoginScreen';
import Layout from './components/Layout';
import { Skeleton } from './components/ui/Skeleton';

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
// visit to a tab doesn't pay for fetching and evaluating its bundle. The service
// worker already caches the files; this also gets them parsed and run ahead of time.
function usePreloadRoutes() {
  useEffect(() => {
    const idle = (cb: () => void) =>
      typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1000);
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

function RouteFallback() {
  const { t } = useFinance();
  // Page-shaped skeleton: title, a row of stat tiles, then a large chart block —
  // the layout most routes settle into, so first paint doesn't flash a blank box.
  return (
    <div className="space-y-4" role="status" aria-label={t.loading}>
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
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
                <Route index element={<Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>} />
                <Route path="budget" element={<Suspense fallback={<RouteFallback />}><BudgetPage /></Suspense>} />
                {/* Dashboard moved from /overview to the index; keep the old path working. */}
                <Route path="overview" element={<Navigate to="/" replace />} />
                <Route path="assets" element={<Suspense fallback={<RouteFallback />}><AssetPage /></Suspense>} />
                <Route path="bolig" element={<Suspense fallback={<RouteFallback />}><BoligPage /></Suspense>} />
                {/* Loan page became the Bolig hub; keep the old path working. */}
                <Route path="loan" element={<Navigate to="/bolig" replace />} />
                <Route path="salary" element={<Suspense fallback={<RouteFallback />}><SalaryPage /></Suspense>} />
                <Route path="forecast" element={<Suspense fallback={<RouteFallback />}><ForecastPage /></Suspense>} />
                <Route path="pension" element={<Suspense fallback={<RouteFallback />}><PensionPage /></Suspense>} />
                <Route path="employer-cost" element={<Suspense fallback={<RouteFallback />}><EmployerCostPage /></Suspense>} />
                <Route path="year" element={<Suspense fallback={<RouteFallback />}><YearReviewPage /></Suspense>} />
                <Route path="settings" element={<Suspense fallback={<RouteFallback />}><SettingsPage /></Suspense>} />
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
