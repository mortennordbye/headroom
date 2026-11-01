import { lazy, useEffect, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { FinanceProvider, useFinanceSettings } from './context/FinanceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import UpdatePrompt from './components/UpdatePrompt';
import CatchupPrompt from './components/CatchupPrompt';
import GainReviewPrompt from './components/GainReviewPrompt';
import LoginScreen from './components/LoginScreen';
import Layout from './components/Layout';

// Code-split per route: each page bundle is fetched only when navigated to.
// Once a bundle has loaded (by a visit or the idle preload below), the page
// renders straight from it. A bare lazy() would still suspend for one beat on its
// first render, and the route's Suspense would flash the skeleton for a page
// whose code is already here.
function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  let Loaded: ComponentType | null = null;
  const preload = () => load().then((m) => { Loaded = m.default; return m; });
  const Lazy = lazy(preload);
  const Page = () => (Loaded ? <Loaded /> : <Lazy />);
  return { Page, preload };
}

const pages = [
  lazyPage(() => import('./pages/DashboardPage')),
  lazyPage(() => import('./pages/BudgetPage')),
  lazyPage(() => import('./pages/AssetPage')),
  lazyPage(() => import('./pages/SalaryPage')),
  lazyPage(() => import('./pages/BoligPage')),
  lazyPage(() => import('./pages/ForecastPage')),
  lazyPage(() => import('./pages/PensionPage')),
  lazyPage(() => import('./pages/EmployerCostPage')),
  lazyPage(() => import('./pages/YearReviewPage')),
  lazyPage(() => import('./pages/SettingsPage')),
];
const [DashboardPage, BudgetPage, AssetPage, SalaryPage, BoligPage, ForecastPage, PensionPage, EmployerCostPage, YearReviewPage, SettingsPage] =
  pages.map(p => p.Page);

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
    const queue = pages.map(p => p.preload);
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
