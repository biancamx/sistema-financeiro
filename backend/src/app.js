import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './config/env.js';
import { setupSecurity } from './middleware/security.js';
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

export function createApp(db) {
  const app = express();

  app.set('trust proxy', 1);

  // Chamada oficial do seu repositório original
  setupSecurity(app);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGIN === '*' || origin === env.CORS_ORIGIN) {
          return callback(null, true);
        }
        if (/^http:\/\/localhost(:\d+)?$/.test(origin) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        callback(new Error('Origem não permitida pelo CORS'));
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
  app.use('/api/portal', portalRoutes(db));

  // ROTAS PÚBLICAS DO API
  const api = Router();
  api.use(systemRoutes(db));
  api.use('/system', systemRoutes(db));
  api.use('/auth', authRoutes(db));
  api.use(requireAuth(db));
  api.use(cacheControl);
  api.use('/purchases', purchasesRoutes(db));
  api.use('/dashboard', dashboardRoutes(db));
  api.use('/cards', cardsRoutes(db));
  api.use('/people', peopleRoutes(db));
  api.use('/categories', categoriesRoutes(db));
  api.use('/budgets', budgetsRoutes(db));
  api.use('/birthdays', birthdaysRoutes(db));
  api.use('/vehicles', vehiclesRoutes(db));
  api.use('/tools', toolsRoutes());
  api.use('/reminders', remindersRoutes(db));
  api.use('/import', importRoutes(db));

  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  app.use(errorHandler);

  return app;
}