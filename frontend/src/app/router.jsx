import { lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui/ui.jsx';
import AppLayout from '../components/layout/AppLayout.jsx';
import { PATHS } from './paths.js';
import { loadRoute } from './routeLoaders.js';

const Login = lazy(() => import('../pages/auth/LoginPage.jsx'));
const Dashboard = lazy(loadRoute(PATHS.dashboard));
const Transactions = lazy(loadRoute(PATHS.transactions));
const Purchases = lazy(loadRoute(PATHS.purchases));
const CashLedger = lazy(loadRoute(PATHS.cashLedger));
const Import = lazy(loadRoute(PATHS.import));
const Export = lazy(loadRoute(PATHS.export));
const Vehicles = lazy(loadRoute(PATHS.vehicles));
const Cards = lazy(loadRoute(PATHS.cards));
const Budget = lazy(loadRoute(PATHS.budget));
const Overview = lazy(loadRoute(PATHS.overview));
const PeopleArea = lazy(() => import('../pages/people/PeopleAreaPage.jsx').then((module) => ({ default: module.PeopleAreaPage })));
const PersonLayout = lazy(() => import('../pages/people/PeopleAreaPage.jsx').then((module) => ({ default: module.PersonPageLayout })));
const PersonSummary = lazy(() => import('../pages/people/PersonTabs.jsx').then((module) => ({ default: module.PersonSummaryPage })));
const PersonPortal = lazy(() => import('../pages/people/PersonTabs.jsx').then((module) => ({ default: module.PersonPortalPage })));
const PersonBilling = lazy(loadRoute('/pessoas/:personId/cobrar'));
const More = lazy(loadRoute(PATHS.more));
const Rescission = lazy(loadRoute(PATHS.rescission));
const Settings = lazy(loadRoute(PATHS.settings));
const AdminUsers = lazy(loadRoute(PATHS.adminUsers));
const Portal = lazy(() => import('../pages/portal/PortalPage.jsx'));
const NotFound = lazy(() => import('../pages/system/NotFoundPage.jsx'));
const AccountStatus = lazy(() => import('../pages/auth/AccountStatusPage.jsx'));

function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <Spinner />;
  if (!user) return <Navigate to={PATHS.login} replace />;
  return user.status === 'active' ? <Outlet /> : <AccountStatus />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <AdminUsers /> : <Navigate to={PATHS.more} replace />;
}

function PublicOnly() {
  const { user, booting } = useAuth();
  if (booting) return <Spinner />;
  return user ? <Navigate to={PATHS.dashboard} replace /> : <Outlet />;
}

function LegacyPersonRedirect({ tab }) {
  const { personId: routePersonId, year: routeYear } = useParams();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const personId = routePersonId || query.get('personId');
  const year = routeYear || query.get('year');
  if (!personId) return <Navigate to={PATHS.people} replace />;
  query.delete('personId');
  query.delete('year');
  const search = query.size ? `?${query}` : '';
  return <Navigate to={`/pessoas/${personId}/${tab}${year ? `/${year}` : ''}${search}`} replace />;
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
          { path: '/painel', element: <Navigate to={PATHS.dashboard} replace /> },
          { path: PATHS.dashboard, element: <Dashboard /> },
          {
            path: PATHS.transactions,
            element: <Transactions />,
            children: [
              { index: true, element: <Navigate to={PATHS.purchases} replace /> },
              { path: 'compras', element: <Purchases /> },
              { path: 'dinheiro', element: <CashLedger /> },
              { path: 'importar', element: <Import /> },
              { path: 'exportar', element: <Export /> },
            ],
          },
          { path: '/avulsos', element: <Navigate to={PATHS.cashLedger} replace /> },
          { path: '/cartoes', element: <Cards /> },
          { path: `${PATHS.vehicles}/:vehicleId?`, element: <Vehicles /> },
          { path: PATHS.people, element: <PeopleArea /> },
          {
            path: '/pessoas/:personId',
            element: <PersonLayout />,
            children: [
              { index: true, element: <PersonSummary /> },
              { path: 'extrato/:year?', element: <Overview /> },
              { path: 'planilha/:year?', element: <Budget /> },
              { path: 'cobrar', element: <PersonBilling /> },
              { path: 'portal', element: <PersonPortal /> },
            ],
          },
          { path: '/visao-geral/:personId?/:year?', element: <LegacyPersonRedirect tab="extrato" /> },
          { path: '/planilha/:personId?/:year?', element: <LegacyPersonRedirect tab="planilha" /> },
          { path: '/aniversarios', element: <Navigate to={PATHS.birthdays} replace /> },
          { path: PATHS.more, element: <More /> },
          { path: PATHS.rescission, element: <Rescission /> },
          { path: PATHS.settings, element: <Settings /> },
          { path: PATHS.adminUsers, element: <AdminOnly /> },
          { path: '/rescisao', element: <Navigate to={PATHS.rescission} replace /> },
          { path: '/configuracoes', element: <Navigate to={PATHS.settings} replace /> },
          { path: '/admin/acessos', element: <Navigate to={PATHS.adminUsers} replace /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
