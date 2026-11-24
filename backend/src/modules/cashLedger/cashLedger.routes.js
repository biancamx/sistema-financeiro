import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { recordAuditEvent } from '../../lib/auditEvent.js';
import { validate } from '../../middleware/validate.js';
import { createCashLedgerService } from './cashLedger.service.js';

const id = z.string().regex(/^[\da-f]{24}$/i);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const amount = z.coerce.number().positive().max(100_000_000);
const entryBody = z.object({
  kind: z.enum(['expense', 'sale', 'loan', 'refund']),
  description: z.string().trim().min(1).max(160),
  total: amount,
  categoryId: z.union([z.null(), id]).optional(),
  personId: id.nullable().optional(),
  counterparty: z.string().trim().max(120).nullable().optional(),
  entryDate: date,
  paymentMethod: z.enum(['cash', 'pix', 'debit', 'transfer']).nullable().optional(),
  downPayment: z.coerce.number().min(0).max(100_000_000).default(0),
  installmentCount: z.coerce.number().int().min(1).max(240).default(1),
  firstDueDate: date,
  frequency: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
  loanTerm: z.enum(['date', 'installments', 'none']).nullable().optional(),
  interestRate: z.coerce.number().min(0).max(100).default(0),
  protocol: z.string().trim().max(120).nullable().optional(),
  expectedReturnDate: date,
  refundStatus: z.enum(['requested', 'in_review', 'received', 'denied']).optional(),
  vehicleId: id.nullable().optional(),
  notes: z.string().max(2000).default(''),
}).superRefine((body, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!body.entryDate) issue('entryDate', 'Informe a data do registro');
  if (['sale', 'loan'].includes(body.kind) && !body.personId) issue('personId', 'Selecione a pessoa');
  if (['expense', 'sale', 'loan'].includes(body.kind) && !body.paymentMethod) issue('paymentMethod', 'Informe a forma de pagamento');
  if (body.kind === 'sale' && !body.firstDueDate && body.installmentCount > 0) issue('firstDueDate', 'Informe o vencimento da primeira parcela');
  if (body.kind === 'sale' && body.downPayment > body.total) issue('downPayment', 'A entrada não pode superar o valor total');
  if (body.kind === 'loan' && body.loanTerm !== 'none' && !body.firstDueDate) issue('firstDueDate', 'Informe a data de pagamento');
  if (body.kind === 'refund' && !body.personId && !body.counterparty?.trim()) issue('counterparty', 'Informe a empresa ou pessoa devedora');
});
const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  all: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  search: z.string().trim().max(100).optional(),
  personId: id.optional(),
  kind: z.enum(['expense', 'sale', 'loan', 'refund']).optional(),
  status: z.string().max(20).optional(),
  paymentMethod: z.enum(['cash', 'pix', 'debit', 'transfer']).optional(),
  categoryId: id.optional(),
});
const receiptBody = z.object({
  amount,
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(['cash', 'pix', 'debit', 'transfer']),
});
const idsBody = z.object({
  ids: z.array(id).min(1).max(5000).refine((ids) => new Set(ids).size === ids.length, 'Parcelas repetidas'),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(['cash', 'pix', 'debit', 'transfer']),
});

export function cashLedgerRoutes() {
  const router = Router();
  const service = createCashLedgerService();
  const entryParam = z.object({ id });
  const installmentParam = z.object({ installmentId: id });
  const receiptParam = z.object({ receiptId: id });

  router.get('/export.csv', asyncHandler(async (req, res) => {
    await recordAuditEvent({
      eventType: 'data.exported',
      actorUserId: req.user._id,
      targetUserId: req.user._id,
      targetId: 'cash-ledger',
      requestId: req.id,
    });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="avulsos.csv"');
    res.send(`\uFEFF${await service.exportCsv(req.user._id)}`);
  }));
  router.get('/summary', validate({ query: z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2000).max(2100) }) }), asyncHandler(async (req, res) =>
    res.json({ data: await service.summary(req.user._id, req.query.month, req.query.year) }),
  ));
  router.get('/dashboard', validate({ query: z.object({
    period: z.enum(['month', 'last3', 'year', 'all']).default('month'),
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  }) }), asyncHandler(async (req, res) =>
    res.json({ data: await service.dashboard(req.user._id, req.query) }),
  ));
  router.get('/people/:id', validate({ params: entryParam }), asyncHandler(async (req, res) => res.json({ data: await service.personSummary(req.user._id, req.params.id) })));
  router.get('/entries', validate({ query: querySchema }), asyncHandler(async (req, res) => res.json(await service.list(req.user._id, req.query))));
  router.post('/entries', validate({ body: entryBody }), asyncHandler(async (req, res) => res.status(201).json({ data: await service.create(req.user._id, req.body) })));
  router.get('/entries/:id', validate({ params: entryParam }), asyncHandler(async (req, res) => res.json({ data: await service.get(req.user._id, req.params.id) })));
  router.put('/entries/:id', validate({ params: entryParam, body: entryBody }), asyncHandler(async (req, res) => res.json({ data: await service.update(req.user._id, req.params.id, req.body) })));
  router.delete('/entries/:id', validate({ params: entryParam, query: z.object({ confirm: z.enum(['true', 'false']).optional() }) }), asyncHandler(async (req, res) => {
    await service.remove(req.user._id, req.params.id, req.query.confirm === 'true');
    res.status(204).end();
  }));
  router.post('/installments/:installmentId/receipts', validate({ params: installmentParam, body: receiptBody }), asyncHandler(async (req, res) =>
    res.status(201).json({ data: await service.receive(req.user._id, req.params.installmentId, req.body) }),
  ));
  router.post('/installments/receive-selected', validate({ body: idsBody }), asyncHandler(async (req, res) =>
    res.json({ data: await service.receiveMany(req.user._id, req.body.ids, req.body.paymentMethod, req.body.receivedOn) }),
  ));
  router.delete('/receipts/:receiptId', validate({ params: receiptParam }), asyncHandler(async (req, res) => {
    res.json({ data: await service.undoReceipt(req.user._id, req.params.receiptId) });
  }));
  router.patch('/entries/:id/refund-status', validate({
    params: entryParam,
    body: z.object({ status: z.enum(['requested', 'in_review', 'received', 'denied']) }),
  }), asyncHandler(async (req, res) => res.json({ data: await service.setRefundStatus(req.user._id, req.params.id, req.body.status) })));
  return router;
}
