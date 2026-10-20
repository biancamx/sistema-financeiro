import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { monthIndex, round2 } from '../../lib/months.js';

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
  const assertOwner = (ownerId, userId) => {
    if (ownerId != null && !db.prepare('SELECT 1 FROM people WHERE id = ? AND user_id = ?').get(ownerId, userId)) {
      throw badRequest('Titular inválido');
    }
  };

  // Apenas parcelas ainda não pagas consomem o limite e compõem a fatura em aberto.
  r.get('/', validate({ query: period }), (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const imageColumn = req.query.withImages === 'true' ? 'c.image_data' : 'NULL';
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.limit_amount AS "limit", c.issuer, c.brand, c.last_four AS lastFour,
           c.color, ${imageColumn} AS imageData, c.owner_id AS ownerId, pe.name AS owner,
           c.due_day AS dueDay, c.closing_day AS closingDay,
           COALESCE((SELECT SUM(MAX(i.amount - i.paid_amount, 0)) FROM installments i JOIN purchases p ON p.id = i.purchase_id
                     WHERE p.card_id = c.id AND (i.year * 12 + i.month) >= ?), 0) AS used,
           COALESCE((SELECT SUM(MAX(i.amount - i.paid_amount, 0)) FROM installments i JOIN purchases p ON p.id = i.purchase_id
                     WHERE p.card_id = c.id AND i.year = ? AND i.month = ?), 0) AS invoice
         FROM cards c LEFT JOIN people pe ON pe.id = c.owner_id
         WHERE c.user_id = ? ORDER BY c.name COLLATE NOCASE`,
      )
      .all(monthIndex(year, month), year, month, req.user.id)
      .map((c) => ({
        ...c,
        used: round2(c.used),
        invoice: round2(c.invoice),
        available: c.limit > 0 ? round2(c.limit - c.used) : 0,
      }));
    res.json({ data: rows, period: { month, year } });
  });

  r.post('/:id/payments', validate({ params: idParam, body: paymentBody }), (req, res) => {
    const { id } = req.params;
    const { month, year, amount } = req.body;
    const card = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!card) throw notFound('Cartão não encontrado');
    const installments = db.prepare(
      `SELECT i.id, i.amount, i.paid_amount AS paidAmount
       FROM installments i JOIN purchases p ON p.id = i.purchase_id
       WHERE p.card_id = ? AND p.user_id = ? AND i.year = ? AND i.month = ?
         AND i.paid_amount < i.amount
       ORDER BY i.id`,
    ).all(id, req.user.id, year, month);
    let remainingCents = Math.round(amount * 100);
    const invoiceCents = installments.reduce((sum, i) => sum + Math.max(0, Math.round((i.amount - i.paidAmount) * 100)), 0);
    if (remainingCents > invoiceCents) throw badRequest('O pagamento não pode ser maior que o valor em aberto da fatura');
    const update = db.prepare('UPDATE installments SET paid_amount = ?, paid = ? WHERE id = ? AND user_id = ?');
    db.transaction(() => {
      for (const installment of installments) {
        if (!remainingCents) break;
        const dueCents = Math.max(0, Math.round((installment.amount - installment.paidAmount) * 100));
        const paidCents = Math.min(dueCents, remainingCents);
        const paidAmount = Math.round((installment.paidAmount * 100) + paidCents) / 100;
        update.run(paidAmount, paidAmount >= installment.amount - 0.005 ? 1 : 0, installment.id, req.user.id);
        remainingCents -= paidCents;
      }
    })();
    res.json({ data: { cardId: id, month, year, amount } });
  });

  r.post('/', validate({ body }), (req, res) => {
    assertOwner(req.body.ownerId, req.user.id);
    const id = db.prepare(
      `INSERT INTO cards (user_id, name, limit_amount, issuer, brand, last_four, color, image_data, owner_id, due_day, closing_day)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      req.user.id, req.body.name, req.body.limit, req.body.issuer, req.body.brand,
      req.body.lastFour ?? null, req.body.color, req.body.imageData ?? null, req.body.ownerId ?? null,
      req.body.dueDay, req.body.closingDay,
    ).lastInsertRowid;
    res.status(201).json({ data: { id: Number(id), ...req.body } });
  });
  r.put('/:id', validate({ params: idParam, body }), (req, res) => {
    assertOwner(req.body.ownerId, req.user.id);
    const info = db.prepare(
      `UPDATE cards SET name=?, limit_amount=?, issuer=?, brand=?, last_four=?, color=?, image_data=?, owner_id=?, due_day=?, closing_day=?
       WHERE id=? AND user_id=?`,
    ).run(
      req.body.name, req.body.limit, req.body.issuer, req.body.brand,
      req.body.lastFour ?? null, req.body.color, req.body.imageData ?? null, req.body.ownerId ?? null,
      req.body.dueDay, req.body.closingDay, req.params.id, req.user.id,
    );
    if (!info.changes) throw notFound('Cartão não encontrado');
    res.json({ data: { id: req.params.id, ...req.body } });
  });
  r.delete('/:id', validate({ params: idParam }), (req, res) => {
    const info = db.prepare('DELETE FROM cards WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    if (!info.changes) throw notFound('Cartão não encontrado');
    res.status(204).end();
  });
  return r;
}
