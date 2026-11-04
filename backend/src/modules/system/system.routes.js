import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import { requireActiveAccount, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { clientLogLimiter } from '../../middleware/rateLimit.js';
import { Birthday } from '../../models/Birthday.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Card } from '../../models/Card.js';
import { CashEntry } from '../../models/CashEntry.js';
import { CashInstallment } from '../../models/CashInstallment.js';
import { CashReceipt } from '../../models/CashReceipt.js';
import { Category } from '../../models/Category.js';
import { Installment } from '../../models/Installment.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { User } from '../../models/User.js';
import { Vehicle } from '../../models/Vehicle.js';
import { VehicleExpense } from '../../models/VehicleExpense.js';

const startedAt = Date.now();

export function systemRoutes() {
  const r = Router();
  // Camada "Availability & Recovery": liveness (processo vivo) e readiness (banco respondendo)
  r.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round((Date.now() - startedAt) / 1000) }));
  r.get('/ready', async (_req, res) => {
    try {
      await mongoose.connection.db.admin().ping();
      res.json({ status: 'ready', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable', db: 'down' });
    }
  });

  // Erros do React (ErrorBoundary) chegam aqui e entram no mesmo fluxo de logs do servidor
  r.post(
    '/client-errors',
    clientLogLimiter,
    validate({ body: z.object({ message: z.string().max(500), stack: z.string().max(4000).optional(), url: z.string().max(300).optional(), componentStack: z.string().max(4000).optional() }) }),
    (req, res) => {
      req.log.error({ clientError: req.body }, 'erro no frontend');
      res.status(202).json({ received: true });
    },
  );

  r.get('/portal-contact', requireAuth(), requireActiveAccount(), asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('portalContactPersonId').lean();
    const person = user?.portalContactPersonId
      ? await Person.findOne({ _id: user.portalContactPersonId, userId: req.user._id }).select('name phone').lean()
      : null;
    res.json({ data: person
      ? { personId: String(user.portalContactPersonId), name: person.name, phone: person.phone }
      : { personId: null, name: null, phone: null } });
  }));

  r.put('/portal-contact', requireAuth(), requireActiveAccount(), validate({
    body: z.object({ personId: z.string().regex(/^[\da-f]{24}$/i).nullable() }),
  }), asyncHandler(async (req, res) => {
    const { personId } = req.body;
    let person = null;
    if (personId !== null) {
      person = await Person.findOne({ _id: personId, userId: req.user._id }).select('name phone').lean();
      if (!person) throw badRequest('Pessoa de contato inválida');
      if (!person.phone || person.phone.replace(/\D/g, '').length < 10) {
        throw badRequest('Cadastre um telefone válido para essa pessoa antes de selecioná-la como contato');
      }
    }
    await User.updateOne({ _id: req.user._id }, { $set: { portalContactPersonId: personId } });
    const contact = personId === null ? { personId: null, name: null, phone: null }
      : { personId, name: person.name, phone: person.phone };
    res.json({ data: contact });
  }));

  r.post('/reset-purchases', requireAuth(), requireActiveAccount(), asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Installment.deleteMany({ userId: req.user._id }, { session });
        await Purchase.deleteMany({ userId: req.user._id }, { session });
        await MonthStatus.deleteMany({ userId: req.user._id }, { session });
      });
      res.json({ message: 'Lançamentos apagados com sucesso.' });
    } catch (error) {
      throw error;
    } finally {
      await session.endSession();
    }
  }));

  r.post('/reset-all', requireAuth(), requireActiveAccount(), asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const filter = { userId: req.user._id };
        for (const model of [
          CashReceipt, CashInstallment, CashEntry, VehicleExpense, Vehicle, Birthday,
          BudgetSheet, MonthStatus, Installment, Purchase, Card, Category, Person,
        ]) await model.deleteMany(filter, { session });
        await User.updateOne(
          { _id: req.user._id },
          { $set: {
            portalContactPersonId: null,
            categoriesInitialized: false,
            reminderSettings: { enabled: true, triggerDay: 5, triggerHour: 9, autoSend: false },
          } },
          { session },
        );
      });
      res.json({ message: 'Dados da conta apagados com sucesso.' });
    } catch (error) {
      throw error;
    } finally {
      await session.endSession();
    }
  }));

  return r;
}
