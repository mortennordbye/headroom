import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { FinanceProvider } from './context/FinanceContext';
import Layout from './components/Layout';
import BudgetPage from './pages/BudgetPage';
import AssetPage from './pages/AssetPage';
import LoanPage from './pages/LoanPage';
import DashboardPage from './pages/DashboardPage';

function App() {
  return (
    <FinanceProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<BudgetPage />} />
            <Route path="overview" element={<DashboardPage />} />
            <Route path="assets" element={<AssetPage />} />
            <Route path="loan" element={<LoanPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </FinanceProvider>
  );
}

export default App;
