import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupSecurity } from './middleware/security.js';
import { requireActiveAccount, requireAuth } from './middleware/auth.js';
import { cacheControl } from './middleware/cacheControl.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';

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
import { adminRoutes } from './modules/admin/admin.routes.js';
import { assistantRoutes } from './modules/assistant/assistant.routes.js';
import { settingsRoutes } from './modules/settings/ai.routes.js';

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(requestLogger);

  // Chamada oficial do seu repositório original
  setupSecurity(app);

  app.use('/api', globalLimiter);
  app.use('/api/import', express.json({ limit: '25mb' }));
  app.use('/api/import', express.urlencoded({ extended: true, limit: '25mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // ROTA PÚBLICA DO PORTAL
  app.use('/api/portal', portalRoutes());

  // ROTAS PÚBLICAS DO API
  const api = Router();
  api.use('/system', systemRoutes());
  api.use('/auth', authRoutes());
  api.use(requireAuth());
  api.use(requireActiveAccount());
  api.use(cacheControl);
  api.use('/assistant', assistantRoutes());
  api.use('/settings', settingsRoutes());
  api.use('/admin', adminRoutes());
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

  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api')) return next();
      if (path.extname(req.path)) return next();
      return res.sendFile(path.join(frontendDist, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}