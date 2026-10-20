import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { cached } from '../../lib/cache.js';
import { createDashboardService } from './dashboard.service.js';

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);
const id = z.coerce.number().int().positive();

export function dashboardRoutes(db) {
  const r = Router();
  const svc = createDashboardService(db);

  r.get('/summary', validate({ query: z.object({ month, year, personId: id.optional() }) }), (req, res) => {
    const q = req.query;
    res.json({ data: cached(req.user.id, `dash:${q.year}-${q.month}-${q.personId ?? ''}`, 30_000, () => svc.summary(req.user.id, q)) });
  });
  r.get('/person-overview', validate({ query: z.object({ personId: id, year }) }), (req, res) =>
    res.json({ data: cached(req.user.id, `ov:${req.query.personId}-${req.query.year}`, 30_000, () => svc.personOverview(req.user.id, req.query.personId, req.query.year)) }),
  );
  r.put('/status', validate({ body: z.object({ personId: id, year, month, status: z.enum(['pending', 'paid']) }) }), (req, res) =>
    res.json({ data: svc.setStatus(req.user.id, req.body) }),
  );
  return r;
}
