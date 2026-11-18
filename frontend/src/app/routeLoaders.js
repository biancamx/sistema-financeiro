import { PATHS } from './paths.js';

const loaders = {
  [PATHS.dashboard]: () => import('../pages/dashboard/DashboardPage.jsx'),
  [PATHS.transactions]: () => import('../pages/transactions/TransactionsPage.jsx'),
  [PATHS.purchases]: () => import('../pages/purchases/PurchasesPage.jsx'),
  [PATHS.cashLedger]: () => import('../pages/cashLedger/CashLedgerPage.jsx'),
  [PATHS.import]: () => import('../pages/settings/SettingsImportPage.jsx'),
  [PATHS.export]: () => import('../pages/transactions/ExportPage.jsx'),
  [PATHS.vehicles]: () => import('../pages/vehicles/VehiclesPage.jsx'),
  [PATHS.cards]: () => import('../pages/cards/CardsPage.jsx'),
  [PATHS.budget]: () => import('../pages/budget/BudgetPage.jsx'),
  [PATHS.overview]: () => import('../pages/overview/OverviewPage.jsx'),
  [PATHS.more]: () => import('../pages/more/MorePage.jsx'),
  [PATHS.rescission]: () => import('../pages/rescission/RescissionPage.jsx'),
  [PATHS.settings]: () => import('../pages/settings/SettingsPage.jsx'),
  [PATHS.adminUsers]: () => import('../pages/admin/AdminUsersPage.jsx'),
  [PATHS.people]: () => import('../pages/people/PeopleAreaPage.jsx'),
  '/pessoas/:personId': () => import('../pages/people/PersonTabs.jsx'),
  '/pessoas/:personId/cobrar': () => import('../pages/people/PersonBillingPage.jsx'),
  '/pessoas/:personId/portal': () => import('../pages/people/PersonTabs.jsx'),
};

export const routePaths = Object.keys(loaders);
const preloadedRoutes = new Map();

export const loadRoute = (path) => loaders[path];

export function preloadRoute(path) {
  const load = loadRoute(path);
  if (!load) return Promise.resolve();
  if (preloadedRoutes.has(path)) return preloadedRoutes.get(path);
  const preload = load().catch((error) => {
    preloadedRoutes.delete(path);
    console.error(`Falha ao antecipar o carregamento de ${path}:`, error);
  });
  preloadedRoutes.set(path, preload);
  return preload;
}
