import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { createPurchasesService } from './purchases.service.js';

const id = z.coerce.number().int().positive();
const optId = z.coerce.number().int().positive().optional();
const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);

const listQuery = z.object({
  personId: optId, cardId: optId, categoryId: optId,
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
});
const monthQuery = listQuery.extend({ month, year });

const purchaseBody = z.object({
  description: z.string().trim().min(1).max(120),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  personId: id,
  cardId: id,
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  total: z.coerce.number().positive().max(10_000_000),
  count: z.coerce.number().int().min(1).max(120),
  startMonth: month,
  startYear: year,
});

// Compra dividida. Participantes: `participants: [{ personId, value }]` (value = % ou R$ do total, conforme splitMode)
// ou, para partes iguais, só `participantIds: [..]`.
const sharedBody = purchaseBody
  .omit({ personId: true })
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

export function purchasesRoutes(db) {
  const r = Router();
  const svc = createPurchasesService(db);

  r.get('/installments', validate({ query: monthQuery }), (req, res) => res.json(svc.listInstallments(req.user.id, req.query)));
  r.get('/export.csv', (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="lancamentos.csv"');
    res.send('\uFEFF' + svc.exportCsv(req.user.id));
  });
  r.patch('/installments/:id', validate({ params: z.object({ id }), body: z.object({ paid: z.boolean() }) }), (req, res) =>
    res.json({ data: svc.setPaid(req.user.id, req.params.id, req.body.paid) }),
  );

  // Compras compartilhadas (um grupo = uma compra dividida entre várias pessoas)
  r.post('/shared', validate({ body: sharedBody }), (req, res) => res.status(201).json({ data: svc.createShared(req.user.id, req.body) }));
  r.get('/shared/:group', validate({ params: groupParam }), (req, res) => res.json({ data: svc.getShared(req.user.id, req.params.group) }));
  r.put('/shared/:group', validate({ params: groupParam, body: sharedBody }), (req, res) => res.json({ data: svc.updateShared(req.user.id, req.params.group, req.body) }));
  r.delete('/shared/:group', validate({ params: groupParam }), (req, res) => {
    svc.removeShared(req.user.id, req.params.group);
    res.status(204).end();
  });

  r.get('/', validate({ query: listQuery }), (req, res) => res.json(svc.list(req.user.id, req.query)));
  r.get('/:id', validate({ params: z.object({ id }) }), (req, res) => res.json({ data: svc.get(req.user.id, req.params.id) }));
  r.post('/', validate({ body: purchaseBody }), (req, res) => res.status(201).json({ data: svc.create(req.user.id, req.body) }));
  r.put('/:id', validate({ params: z.object({ id }), body: purchaseBody }), (req, res) => res.json({ data: svc.update(req.user.id, req.params.id, req.body) }));
  r.delete('/:id', validate({ params: z.object({ id }) }), (req, res) => {
    svc.remove(req.user.id, req.params.id);
    res.status(204).end();
  });
  return r;
}
