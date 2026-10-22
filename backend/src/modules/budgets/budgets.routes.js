import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { SECTION_KEYS } from './budgets.defaults.js';
import { createBudgetsService } from './budgets.service.js';

const id = z.string().regex(/^[\da-f]{24}$/i);
const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);
const money = z.coerce.number().min(-100_000_000).max(100_000_000);

export function budgetsRoutes() {
  const r = Router();
  const svc = createBudgetsService();

  r.get('/years', validate({ query: z.object({ personId: id }) }), asyncHandler(async (req, res) => res.json({ data: await svc.years(req.user._id, req.query.personId) })));
  r.get('/', validate({ query: z.object({ personId: id, year, month: month.optional() }) }), asyncHandler(async (req, res) => {
    const selectedMonth = req.query.month ?? new Date().getMonth() + 1;
    res.json({
      data: await svc.getSheet(req.user._id, req.query.personId, req.query.year, selectedMonth),
    });
  }));
  r.post('/:sheetId/rows', validate({ params: z.object({ sheetId: id }), body: z.object({ section: z.enum(SECTION_KEYS), label: z.string().trim().min(1).max(80) }) }), asyncHandler(async (req, res) =>
    res.status(201).json({ data: await svc.addRow(req.user._id, req.params.sheetId, req.body) }),
  ));
  r.patch('/rows/:rowId', validate({ params: z.object({ rowId: id }), body: z.object({ label: z.string().trim().min(1).max(80).optional(), obs: z.string().max(200).nullable().optional(), receivableFrom: z.string().max(80).nullable().optional() }) }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.updateRow(req.user._id, req.params.rowId, req.body) }),
  ));
  r.delete('/rows/:rowId', validate({ params: z.object({ rowId: id }) }), asyncHandler(async (req, res) => {
    await svc.removeRow(req.user._id, req.params.rowId);
    res.status(204).end();
  }));
  r.put('/rows/:rowId/cells/:month', validate({ params: z.object({ rowId: id, month }), body: z.object({ value: money }) }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.setCell(req.user._id, req.params.rowId, req.params.month, req.body.value) }),
  ));
  r.post('/rows/:rowId/fill', validate({ params: z.object({ rowId: id }), body: z.object({ fromMonth: month, value: money }) }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.fillRow(req.user._id, req.params.rowId, req.body.fromMonth, req.body.value) }),
  ));
  return r;
}
