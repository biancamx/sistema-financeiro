import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { createDashboardService } from './dashboard.service.js';

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);
const id = z.string().regex(/^[\da-f]{24}$/i);

export function dashboardRoutes() {
  const r = Router();
  const svc = createDashboardService();

  r.get('/summary', validate({ query: z.object({ month, year, personId: id.optional() }) }), asyncHandler(async (req, res) => {
    const q = req.query;
    res.json({ data: await svc.summary(req.user._id, q) });
  }));
  r.get('/person-overview', validate({ query: z.object({ personId: id, year }) }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.personOverview(req.user._id, req.query.personId, req.query.year) }),
  ));
  r.put('/status', validate({ body: z.object({ personId: id, year, month, status: z.enum(['pending', 'paid']) }) }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.setStatus(req.user._id, req.body) }),
  ));
  return r;
}
