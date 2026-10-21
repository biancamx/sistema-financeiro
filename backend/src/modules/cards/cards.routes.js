import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { createCardBilling } from '../../lib/cardBilling.js';

const body = z.object({
  name: z.string().trim().min(1).max(60),
  limit: z.coerce.number().min(0).max(10_000_000),
  issuer: z.enum(['Nubank', 'Inter', 'C6 Bank', 'Santander', 'Itaú', 'Bradesco', 'Banco do Brasil', 'Outro']).default('Outro'),
  brand: z.enum(['Visa', 'Mastercard', 'Elo', 'American Express', 'Outro']).default('Outro'),
  lastFour: z.string().regex(/^\d{4}$/).nullable().optional(),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).default('#0f6b66'),
  imageData: z.string().max(80_000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z\d+/]+=*$/).nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).default(10),
  closingDay: z.coerce.number().int().min(1).max(31).default(3),
  closingDayEqual: z.enum(['current', 'next']).default('next'),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const paymentBody = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  amount: z.coerce.number().positive().max(10_000_000)
    .refine((amount) => Math.round(amount * 100) > 0, 'O pagamento mínimo é R$ 0,01')
    .transform((amount) => Math.round(amount * 100) / 100),
});
const period = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  withImages: z.enum(['true', 'false']).optional(),
});

export function cardsRoutes(db) {
  const r = Router();
  const billing = createCardBilling(db);
  const assertOwner = (ownerId, userId) => {
    if (ownerId != null && !db.prepare('SELECT 1 FROM people WHERE id = ? AND user_id = ?').get(ownerId, userId)) {
      throw badRequest('Titular inválido');
    }
  };

  // Limite e fatura são derivados dos centavos que ainda faltam pagar em cada parcela.
  r.get('/', validate({ query: period }), (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const rows = billing.listCards(req.user.id, month, year, req.query.withImages === 'true');
    res.json({ data: rows, period: { month, year } });
  });

  r.post('/:id/payments', validate({ params: idParam, body: paymentBody }), (req, res) => {
    const { month, year, amount } = req.body;
    res.json({ data: billing.recordInvoicePayment(req.user.id, req.params.id, month, year, amount) });
  });

  r.post('/', validate({ body }), (req, res) => {
    assertOwner(req.body.ownerId, req.user.id);
    const id = db.prepare(
      `INSERT INTO cards (user_id, name, limit_amount, issuer, brand, last_four, color, image_data, owner_id, due_day, closing_day, closing_day_equal)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      req.user.id, req.body.name, req.body.limit, req.body.issuer, req.body.brand,
      req.body.lastFour ?? null, req.body.color, req.body.imageData ?? null, req.body.ownerId ?? null,
      req.body.dueDay, req.body.closingDay, req.body.closingDayEqual,
    ).lastInsertRowid;
    res.status(201).json({ data: { id: Number(id), ...req.body } });
  });
  r.put('/:id', validate({ params: idParam, body }), (req, res) => {
    assertOwner(req.body.ownerId, req.user.id);
    const info = db.prepare(
      `UPDATE cards SET name=?, limit_amount=?, issuer=?, brand=?, last_four=?, color=?, image_data=?, owner_id=?, due_day=?, closing_day=?, closing_day_equal=?
       WHERE id=? AND user_id=?`,
    ).run(
      req.body.name, req.body.limit, req.body.issuer, req.body.brand,
      req.body.lastFour ?? null, req.body.color, req.body.imageData ?? null, req.body.ownerId ?? null,
      req.body.dueDay, req.body.closingDay, req.body.closingDayEqual, req.params.id, req.user.id,
    );
    if (!info.changes) throw notFound('Cartão não encontrado');
    db.transaction(() => billing.rescheduleFutureUnpaid(req.user.id, req.params.id))();
    res.json({ data: { id: req.params.id, ...req.body } });
  });
  r.delete('/:id', validate({ params: idParam }), (req, res) => {
    const linkedVehicleExpense = db.prepare(
      'SELECT 1 FROM purchases WHERE card_id = ? AND user_id = ? AND vehicle_expense_id IS NOT NULL LIMIT 1',
    ).get(req.params.id, req.user.id);
    if (linkedVehicleExpense) throw conflict('Este cartão está vinculado a gastos de veículos. Altere ou exclua esses gastos antes de remover o cartão.');
    const info = db.prepare('DELETE FROM cards WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    if (!info.changes) throw notFound('Cartão não encontrado');
    res.status(204).end();
  });
  return r;
}
