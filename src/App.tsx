import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { FinanceProvider } from './context/FinanceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import UpdatePrompt from './components/UpdatePrompt';
import Layout from './components/Layout';

// Code-split per route: each page bundle is fetched only when navigated to.
const BudgetPage = lazy(() => import('./pages/BudgetPage'));
const AssetPage = lazy(() => import('./pages/AssetPage'));
const LoanPage = lazy(() => import('./pages/LoanPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SalaryPage = lazy(() => import('./pages/SalaryPage'));
const ForecastPage = lazy(() => import('./pages/ForecastPage'));
const PensionPage = lazy(() => import('./pages/PensionPage'));
const EmployerCostPage = lazy(() => import('./pages/EmployerCostPage'));

function RouteFallback() {
  return (
    <div className="grid place-items-center py-24 text-[12px]" style={{ color: 'var(--text-3)' }}>
      …
    </div>
  );
}

function App() {
  return (
    <FinanceProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>} />
              <Route path="budget" element={<Suspense fallback={<RouteFallback />}><BudgetPage /></Suspense>} />
              {/* Dashboard moved from /overview to the index; keep the old path working. */}
              <Route path="overview" element={<Navigate to="/" replace />} />
              <Route path="assets" element={<Suspense fallback={<RouteFallback />}><AssetPage /></Suspense>} />
              <Route path="loan" element={<Suspense fallback={<RouteFallback />}><LoanPage /></Suspense>} />
              <Route path="salary" element={<Suspense fallback={<RouteFallback />}><SalaryPage /></Suspense>} />
              <Route path="forecast" element={<Suspense fallback={<RouteFallback />}><ForecastPage /></Suspense>} />
              <Route path="pension" element={<Suspense fallback={<RouteFallback />}><PensionPage /></Suspense>} />
              <Route path="employer-cost" element={<Suspense fallback={<RouteFallback />}><EmployerCostPage /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<RouteFallback />}><SettingsPage /></Suspense>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      <UpdatePrompt />
    </FinanceProvider>
  );
}

export default App;
