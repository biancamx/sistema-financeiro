import { lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui/ui.jsx';
import AppLayout from '../components/layout/AppLayout.jsx';
import { PATHS } from './paths.js';
import { loadRoute } from './routeLoaders.js';

// Code splitting: cada tela vira um arquivo carregado só quando visitada.
const Login = lazy(() => import('../pages/auth/LoginPage.jsx'));
const Dashboard = lazy(loadRoute(PATHS.dashboard));
const Purchases = lazy(loadRoute(PATHS.purchases));
const CashLedger = lazy(loadRoute(PATHS.cashLedger));
const Vehicles = lazy(loadRoute(PATHS.vehicles));
const Cards = lazy(loadRoute(PATHS.cards));
const Budget = lazy(loadRoute(PATHS.budget));
const Overview = lazy(loadRoute(PATHS.overview));
const People = lazy(loadRoute(PATHS.people));
const Birthdays = lazy(loadRoute(PATHS.birthdays));
const Rescission = lazy(loadRoute(PATHS.rescission));
const Settings = lazy(loadRoute(PATHS.settings));
const Portal = lazy(() => import('../pages/portal/PortalPage.jsx'));
const NotFound = lazy(() => import('../pages/system/NotFoundPage.jsx'));
const AccountStatus = lazy(() => import('../pages/auth/AccountStatusPage.jsx'));
const AdminUsers = lazy(loadRoute(PATHS.adminUsers));

/** Camada "Auth & Permissions" no front: rotas privadas só abrem com sessão. */
function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <Spinner />;
  if (!user) return <Navigate to={PATHS.login} replace />;
  return user.status === 'active' ? <Outlet /> : <AccountStatus />;
}
function AdminOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <AdminUsers /> : <Navigate to={PATHS.dashboard} replace />;
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
          { path: PATHS.adminUsers, element: <AdminOnly /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
