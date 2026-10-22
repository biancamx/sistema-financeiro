import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './config/env.js';
import { isAllowedOrigin, setupSecurity } from './middleware/security.js';
import { requireAuth } from './middleware/auth.js';
import { cacheControl } from './middleware/cacheControl.js';
import { errorHandler } from './middleware/errorHandler.js';

import { authRoutes } from './modules/auth/auth.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { purchasesRoutes } from './modules/purchases/purchases.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { cardsRoutes } from './modules/cards/cards.routes.js';
import { peopleRoutes } from './modules/people/people.routes.js';
import { categoriesRoutes } from './modules/categories/categories.routes.js';
import { budgetsRoutes } from './modules/budgets/budgets.routes.js';
import { birthdaysRoutes } from './modules/birthdays/birthdays.routes.js';
import { toolsRoutes } from './modules/tools/tools.routes.js';
import { vehiclesRoutes } from './modules/vehicles/vehicles.routes.js';
import { remindersRoutes } from './modules/reminders/reminders.routes.js';
import { portalRoutes } from './modules/portal/portal.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { cashLedgerRoutes } from './modules/cashLedger/cashLedger.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  // Chamada oficial do seu repositório original
  setupSecurity(app);

  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    })
  );

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));
  app.use(cookieParser());

  // ROTA PÚBLICA DO PORTAL
  app.use('/api/portal', portalRoutes());

  // ROTAS PÚBLICAS DO API
  const api = Router();
  api.use(systemRoutes());
  api.use('/system', systemRoutes());
  api.use('/auth', authRoutes());
  api.use(requireAuth());
  api.use(cacheControl);
  api.use('/purchases', purchasesRoutes());
  api.use('/dashboard', dashboardRoutes());
  api.use('/cards', cardsRoutes());
  api.use('/people', peopleRoutes());
  api.use('/categories', categoriesRoutes());
  api.use('/budgets', budgetsRoutes());
  api.use('/birthdays', birthdaysRoutes());
  api.use('/vehicles', vehiclesRoutes());
  api.use('/tools', toolsRoutes());
  api.use('/reminders', remindersRoutes());
  api.use('/import', importRoutes());
  api.use('/cash-ledger', cashLedgerRoutes());

  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  app.use(errorHandler);

  return app;
}