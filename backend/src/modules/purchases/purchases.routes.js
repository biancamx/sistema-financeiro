import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { recordAuditEvent } from '../../lib/auditEvent.js';
import { validate } from '../../middleware/validate.js';
import { createPurchasesService } from './purchases.service.js';

const id = z.string().regex(/^[\da-f]{24}$/i);
const optId = id.optional();
const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);
const purchaseDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Data da compra inválida');

const listQuery = z.object({
  personId: optId, cardId: optId, categoryId: optId,
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});
const monthQuery = listQuery.extend({ month, year });
const subscriptionQuery = listQuery.extend({ status: z.enum(['active', 'canceled']).optional() });
const installmentIds = z.object({
  ids: z.array(id).min(1).max(5000).refine((ids) => new Set(ids).size === ids.length, 'Parcelas repetidas'),
});

const purchaseBodyBase = z.object({
  description: z.string().trim().min(1).max(120),
  categoryId: z.union([z.null(), id]).optional(),
  observation: z.string().max(1000).optional(),
  personId: id,
  cardId: id,
  purchaseDate: purchaseDate.nullable().optional(),
  total: z.coerce.number().positive().max(10_000_000),
  count: z.coerce.number().int().min(1).max(120),
  startMonth: month,
  startYear: year,
  isSubscription: z.boolean().default(false),
});
const purchaseBody = purchaseBodyBase.superRefine((body, ctx) => {
  if (body.isSubscription && body.count !== 1) {
    ctx.addIssue({ code: 'custom', message: 'Uma assinatura deve ser cadastrada como recorrência mensal.', path: ['count'] });
  }
});

// Compra dividida. Participantes: `participants: [{ personId, value }]` (value = % ou R$ do total, conforme splitMode)
// ou, para partes iguais, só `participantIds: [..]`.
const sharedBody = purchaseBodyBase
  .omit({ personId: true, isSubscription: true })
  .extend({
    splitMode: z.enum(['equal', 'percent', 'amount']).default('equal'),
    participantIds: z.array(id).max(20).optional(),
    participants: z.array(z.object({ personId: id, value: z.coerce.number().positive().max(10_000_000).optional() })).max(20).optional(),
  })
  .superRefine((b, ctx) => {
    const list = b.participants ?? (b.participantIds || []).map((personId) => ({ personId }));
    const fail = (message) => ctx.addIssue({ code: 'custom', message, path: ['participants'] });
    if (list.length < 2) return fail('Escolha pelo menos 2 participantes');
    if (new Set(list.map((p) => p.personId)).size !== list.length) return fail('Participantes repetidos');
    if (b.splitMode !== 'equal' && list.some((p) => !(p.value > 0))) fail('Informe a parte de cada participante');
  })
  .transform((b) => {
    const { participantIds, participants, ...rest } = b;
    return { ...rest, participants: participants ?? (participantIds || []).map((personId) => ({ personId })) };
  });
const groupParam = z.object({ group: z.string().uuid() });

export function purchasesRoutes() {
  const r = Router();
  const svc = createPurchasesService();

  r.get('/installments', validate({ query: monthQuery }), asyncHandler(async (req, res) => res.json(await svc.listInstallments(req.user._id, req.query))));
  r.get('/subscriptions', validate({ query: subscriptionQuery }), asyncHandler(async (req, res) =>
    res.json(await svc.listSubscriptions(req.user._id, req.query)),
  ));
  r.get('/export.csv', asyncHandler(async (req, res) => {
    await recordAuditEvent({
      eventType: 'data.exported',
      actorUserId: req.user._id,
      targetUserId: req.user._id,
      targetId: 'purchases',
      requestId: req.id,
    });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="lancamentos.csv"');
    res.send('\uFEFF' + await svc.exportCsv(req.user._id));
  }));
  r.post('/installments/pay-selected', validate({ body: installmentIds }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.setManyPaid(req.user._id, req.body.ids, true) }),
  ));
  r.post('/installments/unpay-selected', validate({ body: installmentIds }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.setManyPaid(req.user._id, req.body.ids, false) }),
  ));
  r.patch('/installments/:id', validate({ params: z.object({ id }), body: z.object({ paid: z.boolean() }) }), asyncHandler(async (req, res) =>
    res.json({ data: await svc.setPaid(req.user._id, req.params.id, req.body.paid) }),
  ));
  r.patch('/:id/observation', validate({
    params: z.object({ id }),
    body: z.object({ observation: z.string().max(1000) }),
  }), asyncHandler(async (req, res) => res.json({ data: await svc.updateObservation(req.user._id, req.params.id, req.body.observation) })));
  r.patch('/:id/subscription-status', validate({
    params: z.object({ id }),
    body: z.object({ status: z.enum(['active', 'canceled']) }),
  }), asyncHandler(async (req, res) => res.json({
    data: await svc.setSubscriptionStatus(req.user._id, req.params.id, req.body.status),
  })));

  // Compras compartilhadas (um grupo = uma compra dividida entre várias pessoas)
  r.post('/shared', validate({ body: sharedBody }), asyncHandler(async (req, res) => res.status(201).json({ data: await svc.createShared(req.user._id, req.body) })));
  r.get('/shared/:group', validate({ params: groupParam }), asyncHandler(async (req, res) => res.json({ data: await svc.getShared(req.user._id, req.params.group) })));
  r.put('/shared/:group', validate({ params: groupParam, body: sharedBody }), asyncHandler(async (req, res) => res.json({ data: await svc.updateShared(req.user._id, req.params.group, req.body) })));
  r.delete('/shared/:group', validate({ params: groupParam }), asyncHandler(async (req, res) => {
    await svc.removeShared(req.user._id, req.params.group);
    res.status(204).end();
  }));

  r.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => res.json(await svc.list(req.user._id, req.query))));
  r.get('/:id', validate({ params: z.object({ id }) }), asyncHandler(async (req, res) => res.json({ data: await svc.get(req.user._id, req.params.id) })));
  r.post('/', validate({ body: purchaseBody }), asyncHandler(async (req, res) => res.status(201).json({ data: await svc.create(req.user._id, req.body) })));
  r.put('/:id', validate({ params: z.object({ id }), body: purchaseBody }), asyncHandler(async (req, res) => res.json({ data: await svc.update(req.user._id, req.params.id, req.body) })));
  r.delete('/:id', validate({ params: z.object({ id }) }), asyncHandler(async (req, res) => {
    await svc.remove(req.user._id, req.params.id);
    res.status(204).end();
  }));
  return r;
}
