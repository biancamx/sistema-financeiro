import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { cached } from '../../lib/cache.js';
import { SECTION_KEYS } from './budgets.defaults.js';
import { createBudgetsService } from './budgets.service.js';

const id = z.coerce.number().int().positive();
const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);
const money = z.coerce.number().min(-100_000_000).max(100_000_000);

export function budgetsRoutes(db) {
  const r = Router();
  const svc = createBudgetsService(db);

  r.get('/years', validate({ query: z.object({ personId: id }) }), (req, res) => res.json({ data: svc.years(req.user.id, req.query.personId) }));
  r.get('/', validate({ query: z.object({ personId: id, year }) }), (req, res) =>
    res.json({ data: cached(req.user.id, `budget:${req.query.personId}:${req.query.year}`, 30_000, () => svc.getSheet(req.user.id, req.query.personId, req.query.year)) }),
  );
  r.post('/:sheetId/rows', validate({ params: z.object({ sheetId: id }), body: z.object({ section: z.enum(SECTION_KEYS), label: z.string().trim().min(1).max(80) }) }), (req, res) =>
    res.status(201).json({ data: svc.addRow(req.user.id, req.params.sheetId, req.body) }),
  );
  r.patch('/rows/:rowId', validate({ params: z.object({ rowId: id }), body: z.object({ label: z.string().trim().min(1).max(80).optional(), obs: z.string().max(200).nullable().optional(), receivableFrom: z.string().max(80).nullable().optional() }) }), (req, res) =>
    res.json({ data: svc.updateRow(req.user.id, req.params.rowId, req.body) }),
  );
  r.delete('/rows/:rowId', validate({ params: z.object({ rowId: id }) }), (req, res) => {
    svc.removeRow(req.user.id, req.params.rowId);
    res.status(204).end();
  });
  r.put('/rows/:rowId/cells/:month', validate({ params: z.object({ rowId: id, month }), body: z.object({ value: money }) }), (req, res) =>
    res.json({ data: svc.setCell(req.user.id, req.params.rowId, req.params.month, req.body.value) }),
  );
  r.post('/rows/:rowId/fill', validate({ params: z.object({ rowId: id }), body: z.object({ fromMonth: month, value: money }) }), (req, res) =>
    res.json({ data: svc.fillRow(req.user.id, req.params.rowId, req.body.fromMonth, req.body.value) }),
  );
  return r;
}
