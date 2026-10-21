import { lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui/ui.jsx';
import AppLayout from '../components/layout/AppLayout.jsx';
import { PATHS } from './paths.js';

// Code splitting: cada tela vira um arquivo carregado só quando visitada.
const Login = lazy(() => import('../pages/auth/LoginPage.jsx'));
const Dashboard = lazy(() => import('../pages/dashboard/DashboardPage.jsx'));
const Purchases = lazy(() => import('../pages/purchases/PurchasesPage.jsx'));
const CashLedger = lazy(() => import('../pages/cashLedger/CashLedgerPage.jsx'));
const Vehicles = lazy(() => import('../pages/vehicles/VehiclesPage.jsx'));
const Cards = lazy(() => import('../pages/cards/CardsPage.jsx'));
const Budget = lazy(() => import('../pages/budget/BudgetPage.jsx'));
const Overview = lazy(() => import('../pages/overview/OverviewPage.jsx'));
const People = lazy(() => import('../pages/people/PeoplePage.jsx'));
const Birthdays = lazy(() => import('../pages/birthdays/BirthdaysPage.jsx'));
const Rescission = lazy(() => import('../pages/rescission/RescissionPage.jsx'));
const Settings = lazy(() => import('../pages/settings/SettingsPage.jsx'));
const Portal = lazy(() => import('../pages/portal/PortalPage.jsx'));
const NotFound = lazy(() => import('../pages/system/NotFoundPage.jsx'));

/** Camada "Auth & Permissions" no front: rotas privadas só abrem com sessão. */
function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <Spinner />;
  return user ? <Outlet /> : <Navigate to={PATHS.login} replace />;
}
function PublicOnly() {
  const { user, booting } = useAuth();
  if (booting) return <Spinner />;
  return user ? <Navigate to={PATHS.dashboard} replace /> : <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/portal/:token', element: <Portal /> },
  { element: <PublicOnly />, children: [{ path: PATHS.login, element: <Login /> }] },
  {
    element: <Protected />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Navigate to={PATHS.dashboard} replace /> },
          { path: PATHS.dashboard, element: <Dashboard /> },
          { path: PATHS.purchases, element: <Purchases /> },
          { path: PATHS.cashLedger, element: <CashLedger /> },
          { path: PATHS.cards, element: <Cards /> },
          { path: `${PATHS.vehicles}/:vehicleId?`, element: <Vehicles /> },
          { path: `${PATHS.budget}/:personId?/:year?`, element: <Budget /> },
          { path: `${PATHS.overview}/:personId?/:year?`, element: <Overview /> },
          { path: PATHS.people, element: <People /> },
          { path: PATHS.birthdays, element: <Birthdays /> },
          { path: PATHS.rescission, element: <Rescission /> },
          { path: PATHS.settings, element: <Settings /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
