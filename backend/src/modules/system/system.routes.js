import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { validate } from '../../middleware/validate.js';
import { clientLogLimiter } from '../../middleware/rateLimit.js';

const startedAt = Date.now();

export function systemRoutes(db) {
  const r = Router();
  // Camada "Availability & Recovery": liveness (processo vivo) e readiness (banco respondendo)
  r.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round((Date.now() - startedAt) / 1000) }));
  r.get('/ready', (_req, res) => {
    try {
      if (db && typeof db.prepare === 'function') {
        db.prepare('SELECT 1').get();
      }
      res.json({ status: 'ready', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable', db: 'down' });
    }
  });

  // Erros do React (ErrorBoundary) chegam aqui e entram no mesmo fluxo de logs do servidor
  r.post(
    '/client-errors',
    clientLogLimiter,
    validate({ body: z.object({ message: z.string().max(500), stack: z.string().max(4000).optional(), url: z.string().max(300).optional(), componentStack: z.string().max(4000).optional() }) }),
    (req, res) => {
      req.log.error({ clientError: req.body }, 'erro no frontend');
      res.status(202).json({ received: true });
    },
  );
  return r;
}
