import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { createCardBilling } from '../../lib/cardBilling.js';
import { Card, normalizeCardBrand } from '../../models/Card.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { Installment } from '../../models/Installment.js';

export const cardBrandSchema = z.preprocess(
  normalizeCardBrand,
  z.enum(['Visa', 'Mastercard', 'Elo', 'American Express', 'Outro']),
);
const body = z.object({
  name: z.string().trim().min(1).max(60),
  limit: z.coerce.number().min(0).max(10_000_000),
  issuer: z.enum(['Nubank', 'Inter', 'C6 Bank', 'Santander', 'Itaú', 'Bradesco', 'Banco do Brasil', 'Outro']).default('Outro'),
  brand: cardBrandSchema,
  lastFour: z.string().regex(/^\d{4}$/).nullable().optional(),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).default('#0f6b66'),
  imageData: z.string().max(80_000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z\d+/]+=*$/).nullable().optional(),
  ownerId: z.string().regex(/^[\da-f]{24}$/i).nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).default(10),
  closingDay: z.coerce.number().int().min(1).max(31).default(3),
  closingDayEqual: z.enum(['current', 'next']).default('next'),
});
const idParam = z.object({ id: z.string().regex(/^[\da-f]{24}$/i) });
const updateBody = body.extend({ id: z.string().regex(/^[\da-f]{24}$/i).optional() });
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

export function cardsRoutes() {
  const r = Router();
  const billing = createCardBilling();
  const assertOwner = async (ownerId, userId) => {
    if (ownerId != null && !await Person.exists({ _id: ownerId, userId })) {
      throw badRequest('Titular inválido');
    }
  };

  // Limite e fatura são derivados dos centavos que ainda faltam pagar em cada parcela.
  r.get('/', validate({ query: period }), asyncHandler(async (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const rows = await billing.listCards(req.user._id, month, year, req.query.withImages === 'true');
    res.json({ data: rows, period: { month, year } });
  }));

  r.post('/:id/payments', validate({ params: idParam, body: paymentBody }), asyncHandler(async (req, res) => {
    const { month, year, amount } = req.body;
    res.json({ data: await billing.recordInvoicePayment(req.user._id, req.params.id, month, year, amount) });
  }));

  r.post('/', validate({ body }), asyncHandler(async (req, res) => {
    const userId = req.user._id;
    await assertOwner(req.body.ownerId, userId);
    const card = await Card.create({
      userId, name: req.body.name, limit: req.body.limit, issuer: req.body.issuer, brand: req.body.brand,
      lastDigits: req.body.lastFour ?? null, color: req.body.color, imageData: req.body.imageData ?? null,
      ownerId: req.body.ownerId ?? null, dueDay: req.body.dueDay, closingDay: req.body.closingDay,
      closingDayEqual: req.body.closingDayEqual,
    });
    res.status(201).json({ data: { id: String(card._id), ...req.body } });
  }));
  r.put('/:id', validate({ params: idParam, body: updateBody }), asyncHandler(async (req, res) => {
    if (req.body.id && req.body.id !== req.params.id) throw badRequest('ID do cartão não corresponde à rota.');
    const userId = req.user._id;
    await assertOwner(req.body.ownerId, userId);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const card = await Card.findOneAndUpdate(
          { _id: req.params.id, userId },
          {
            name: req.body.name, limit: req.body.limit, issuer: req.body.issuer, brand: req.body.brand,
            lastDigits: req.body.lastFour ?? null, color: req.body.color, imageData: req.body.imageData ?? null,
            ownerId: req.body.ownerId ?? null, dueDay: req.body.dueDay, closingDay: req.body.closingDay,
            closingDayEqual: req.body.closingDayEqual,
          },
          { returnDocument: 'after', runValidators: true, session },
        );
        if (!card) throw notFound('Cartão não encontrado');
        await billing.rescheduleFutureUnpaid(userId, req.params.id, new Date(), session);
      });
    } finally {
      await session.endSession();
    }
    res.json({ data: { id: req.params.id, ...req.body } });
  }));
  r.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const linkedVehicleExpense = await Purchase.exists({ cardId: req.params.id, userId, vehicleExpenseId: { $ne: null } });
    if (linkedVehicleExpense) throw conflict('Este cartão está vinculado a gastos de veículos. Altere ou exclua esses gastos antes de remover o cartão.');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const card = await Card.findOne({ _id: req.params.id, userId }).session(session);
        if (!card) throw notFound('Cartão não encontrado');
        const purchases = await Purchase.find({ cardId: card._id, userId }).select('_id').session(session).lean();
        await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map(({ _id }) => _id) } }, { session });
        await Purchase.deleteMany({ cardId: card._id, userId }, { session });
        await card.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    res.status(204).end();
  }));
  return r;
}
