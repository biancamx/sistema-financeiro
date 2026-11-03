import { PATHS } from './paths.js';

const loaders = {
  [PATHS.dashboard]: () => import('../pages/dashboard/DashboardPage.jsx'),
  [PATHS.purchases]: () => import('../pages/purchases/PurchasesPage.jsx'),
  [PATHS.cashLedger]: () => import('../pages/cashLedger/CashLedgerPage.jsx'),
  [PATHS.vehicles]: () => import('../pages/vehicles/VehiclesPage.jsx'),
  [PATHS.cards]: () => import('../pages/cards/CardsPage.jsx'),
  [PATHS.budget]: () => import('../pages/budget/BudgetPage.jsx'),
  [PATHS.overview]: () => import('../pages/overview/OverviewPage.jsx'),
  [PATHS.people]: () => import('../pages/people/PeoplePage.jsx'),
  [PATHS.birthdays]: () => import('../pages/birthdays/BirthdaysPage.jsx'),
  [PATHS.rescission]: () => import('../pages/rescission/RescissionPage.jsx'),
  [PATHS.settings]: () => import('../pages/settings/SettingsPage.jsx'),
  [PATHS.adminUsers]: () => import('../pages/admin/AdminUsersPage.jsx'),
};

export const routePaths = Object.keys(loaders);

export const loadRoute = (path) => loaders[path];

export function preloadRoute(path) {
  const load = loadRoute(path);
  if (!load) return Promise.resolve();
  return load().catch((error) => {
    console.error(`Falha ao antecipar o carregamento de ${path}:`, error);
  });
}
