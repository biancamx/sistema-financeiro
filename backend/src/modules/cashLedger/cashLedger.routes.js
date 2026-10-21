import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { createCashLedgerService } from './cashLedger.service.js';

const id = z.coerce.number().int().positive();
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

export function cashLedgerRoutes(db) {
  const router = Router();
  const service = createCashLedgerService(db);
  const entryParam = z.object({ id });
  const installmentParam = z.object({ installmentId: id });
  const receiptParam = z.object({ receiptId: id });

  router.get('/export.csv', (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="avulsos.csv"');
    res.send(`\uFEFF${service.exportCsv(req.user.id)}`);
  });
  router.get('/summary', validate({ query: z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2000).max(2100) }) }), (req, res) =>
    res.json({ data: service.summary(req.user.id, req.query.month, req.query.year) }),
  );
  router.get('/dashboard', validate({ query: z.object({
    period: z.enum(['month', 'last3', 'year', 'all']).default('month'),
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  }) }), (req, res) =>
    res.json({ data: service.dashboard(req.user.id, req.query) }),
  );
  router.get('/people/:id', validate({ params: entryParam }), (req, res) => res.json({ data: service.personSummary(req.user.id, req.params.id) }));
  router.get('/entries', validate({ query: querySchema }), (req, res) => res.json(service.list(req.user.id, req.query)));
  router.post('/entries', validate({ body: entryBody }), (req, res) => res.status(201).json({ data: service.create(req.user.id, req.body) }));
  router.get('/entries/:id', validate({ params: entryParam }), (req, res) => res.json({ data: service.get(req.user.id, req.params.id) }));
  router.put('/entries/:id', validate({ params: entryParam, body: entryBody }), (req, res) => res.json({ data: service.update(req.user.id, req.params.id, req.body) }));
  router.delete('/entries/:id', validate({ params: entryParam, query: z.object({ confirm: z.enum(['true', 'false']).optional() }) }), (req, res) => {
    service.remove(req.user.id, req.params.id, req.query.confirm === 'true');
    res.status(204).end();
  });
  router.post('/installments/:installmentId/receipts', validate({ params: installmentParam, body: receiptBody }), (req, res) =>
    res.status(201).json({ data: service.receive(req.user.id, req.params.installmentId, req.body) }),
  );
  router.post('/installments/receive-selected', validate({ body: idsBody }), (req, res) =>
    res.json({ data: service.receiveMany(req.user.id, req.body.ids, req.body.paymentMethod, req.body.receivedOn) }),
  );
  router.delete('/receipts/:receiptId', validate({ params: receiptParam }), (req, res) => {
    res.json({ data: service.undoReceipt(req.user.id, req.params.receiptId) });
  });
  router.patch('/entries/:id/refund-status', validate({
    params: entryParam,
    body: z.object({ status: z.enum(['requested', 'in_review', 'received', 'denied']) }),
  }), (req, res) => res.json({ data: service.setRefundStatus(req.user.id, req.params.id, req.body.status) }));
  return router;
}
