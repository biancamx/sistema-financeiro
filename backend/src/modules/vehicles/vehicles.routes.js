import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { createVehiclesService } from './vehicles.service.js';
import { CATEGORY_KEYS, GROUP_KEYS } from './vehicles.categories.js';

const id = z.coerce.number().int().positive();
const optId = z.coerce.number().int().positive().optional();
const idParam = z.object({ id });

const realDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Data inválida');

const vehicleBody = z.object({
  kind: z.enum(['car', 'motorcycle', 'utility', 'other']).default('car'),
  model: z.string().trim().min(1, 'Informe o modelo').max(80),
  plate: z.string().trim().transform((s) => s.toUpperCase().replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,8}$/, 'Placa inválida')),
  year: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  purchaseValue: z.coerce.number().min(0).max(100_000_000).default(0),
  status: z.enum(['active', 'inactive', 'sold']).default('active'),
  notes: z.string().trim().max(500).nullable().optional(),
});

// Individual: tudo é do pagador. Compartilhado: `participants` (2+), com `value` = % ou R$ conforme splitMode
// (ou só `participantIds` para partes iguais).
const expenseBody = z
  .object({
    vehicleId: id,
    date: realDate,
    category: z.enum(CATEGORY_KEYS),
    description: z.string().trim().max(200).default(''),
    amount: z.coerce.number().min(1, 'O valor mínimo é R$ 1,00').max(10_000_000),
    km: z.coerce.number().int().min(0).max(5_000_000).nullable().optional(),
    payerId: id,
    shared: z.boolean().default(false),
    splitMode: z.enum(['equal', 'percent', 'amount']).default('equal'),
    participantIds: z.array(id).max(20).optional(),
    participants: z.array(z.object({ personId: id, value: z.coerce.number().positive().max(10_000_000).optional() })).max(20).optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.shared) return;
    const list = b.participants ?? (b.participantIds || []).map((personId) => ({ personId }));
    const fail = (message) => ctx.addIssue({ code: 'custom', message, path: ['participants'] });
    if (list.length < 2) return fail('Escolha pelo menos 2 participantes');
    if (new Set(list.map((p) => p.personId)).size !== list.length) return fail('Participantes repetidos');
    if (b.splitMode !== 'equal' && list.some((p) => !(p.value > 0))) fail('Informe a parte de cada participante');
  })
  .transform((b) => {
    const { participantIds, participants, ...rest } = b;
    return { ...rest, participants: rest.shared ? participants ?? (participantIds || []).map((personId) => ({ personId })) : [] };
  });

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const expenseFilters = {
  vehicleId: optId,
  category: z.enum(CATEGORY_KEYS).optional(),
  group: z.enum(GROUP_KEYS).optional(),
  personId: optId,
  shared: bool.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: realDate.optional(),
  to: realDate.optional(),
  search: z.string().trim().max(80).optional(),
};
const listQuery = z.object({ ...expenseFilters, page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(30) });
const exportQuery = z.object(expenseFilters);
const summaryQuery = z.object({ vehicleId: optId, year: z.coerce.number().int().min(2000).max(2100).optional() });

export function vehiclesRoutes(db) {
  const r = Router();
  const svc = createVehiclesService(db);

  r.get('/categories', (_req, res) => res.json({ data: svc.categories() }));
  r.get('/summary', validate({ query: summaryQuery }), (req, res) => res.json({ data: svc.summary(req.user.id, req.query) }));

  // Lançamentos (declarados antes de /:id para não colidir)
  r.get('/expenses/export.csv', validate({ query: exportQuery }), (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="gastos-veiculos.csv"');
    res.send('﻿' + svc.exportCsv(req.user.id, req.query));
  });
  r.get('/expenses', validate({ query: listQuery }), (req, res) => res.json(svc.listExpenses(req.user.id, req.query)));
  r.get('/expenses/:id', validate({ params: idParam }), (req, res) => res.json({ data: svc.getExpense(req.user.id, req.params.id) }));
  r.post('/expenses', validate({ body: expenseBody }), (req, res) => res.status(201).json({ data: svc.createExpense(req.user.id, req.body) }));
  r.put('/expenses/:id', validate({ params: idParam, body: expenseBody }), (req, res) => res.json({ data: svc.updateExpense(req.user.id, req.params.id, req.body) }));
  r.delete('/expenses/:id', validate({ params: idParam }), (req, res) => {
    svc.removeExpense(req.user.id, req.params.id);
    res.status(204).end();
  });

  // Veículos (ficha)
  r.get('/', (req, res) => res.json({ data: svc.listVehicles(req.user.id) }));
  r.post('/', validate({ body: vehicleBody }), (req, res) => res.status(201).json({ data: svc.createVehicle(req.user.id, req.body) }));
  r.get('/:id', validate({ params: idParam }), (req, res) => res.json({ data: svc.getVehicle(req.user.id, req.params.id) }));
  r.put('/:id', validate({ params: idParam, body: vehicleBody }), (req, res) => res.json({ data: svc.updateVehicle(req.user.id, req.params.id, req.body) }));
  r.delete('/:id', validate({ params: idParam, query: z.object({ force: bool.optional() }) }), (req, res) => {
    svc.removeVehicle(req.user.id, req.params.id, Boolean(req.query.force));
    res.status(204).end();
  });
  return r;
}
