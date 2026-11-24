import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, conflict, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { Person, generatePortalToken, hashPortalToken } from '../../models/Person.js';
import { Birthday } from '../../models/Birthday.js';
import { Purchase } from '../../models/Purchase.js';
import { VehicleExpense } from '../../models/VehicleExpense.js';
import { Installment } from '../../models/Installment.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { CashEntry } from '../../models/CashEntry.js';
import { Card } from '../../models/Card.js';
import { Vehicle } from '../../models/Vehicle.js';
import { User } from '../../models/User.js';
import { recordAuditEvent } from '../../lib/auditEvent.js';
import { requireRecentAuth } from '../../middleware/auth.js';

const PORTAL_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const birthDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento inválida')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Data de nascimento inválida')
  .nullable()
  .optional();

const body = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  birthDate,
  pixKey: z.string().trim().max(120).nullable().optional(),
  avatar: z.string().max(30_000).regex(/^data:image\/jpeg;base64,[A-Za-z\d+/]+=*$/).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const idParam = z.object({ id: z.string().regex(/^[\da-f]{24}$/i) });

function personJson(person, purchases = 0) {
  const shareEnabled = Boolean((person.shareTokenHash || person.shareToken)
    && !person.shareTokenRevokedAt
    && (!person.shareTokenExpiresAt || person.shareTokenExpiresAt > new Date()));
  return {
    id: String(person._id),
    name: person.name,
    phone: person.phone,
    email: person.email,
    birth_date: person.birthDate,
    pix_key: person.pixKey,
    avatar: person.avatar,
    notes: person.notes,
    share_token: shareEnabled ? person.shareToken || null : null,
    share_enabled: shareEnabled,
    share_expires_at: person.shareTokenExpiresAt || null,
    purchases,
  };
}

async function syncBirthday(userId, person, session) {
  if (!person.birthDate) {
    await Birthday.deleteOne({ userId, personId: person._id }).session(session);
    return;
  }
  const [, month, day] = person.birthDate.split('-').map(Number);
  await Birthday.findOneAndUpdate(
    { userId, personId: person._id },
    { $set: { name: person.name, day, month }, $setOnInsert: { userId, personId: person._id } },
    { upsert: true, session, runValidators: true, setDefaultsOnInsert: true },
  );
}

export function peopleRoutes() {
  const r = Router();
  r.get('/', asyncHandler(async (req, res) => {
    const people = await Person.find({ userId: req.user._id }).select('+shareTokenHash').sort({ name: 1 }).lean();
    const counts = await Purchase.aggregate([
      { $match: { userId: req.user._id, personId: { $in: people.map((person) => person._id) } } },
      { $group: { _id: '$personId', count: { $sum: 1 } } },
    ]);
    const countByPerson = new Map(counts.map((item) => [String(item._id), item.count]));
    res.json({ data: people.map((person) => personJson(person, countByPerson.get(String(person._id)) ?? 0)) });
  }));
  r.post('/', validate({ body }), asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    let created;
    try {
      await session.withTransaction(async () => {
        const [person] = await Person.create([{
          userId: req.user._id,
          name: req.body.name,
          phone: req.body.phone || null,
          email: req.body.email ? req.body.email.toLowerCase() : null,
          birthDate: req.body.birthDate || null,
          pixKey: req.body.pixKey || null,
          avatar: req.body.avatar || null,
          notes: req.body.notes || null,
        }], { session });
        created = person;
        await syncBirthday(req.user._id, person, session);
      });
    } finally {
      await session.endSession();
    }
    res.status(201).json({ data: personJson(created) });
  }));
  r.post('/:id/share-link', requireRecentAuth(), validate({ params: idParam }), asyncHandler(async (req, res) => {
    const person = await Person.findOne({ _id: req.params.id, userId: req.user._id }).select('+shareTokenHash');
    if (!person) throw notFound('Pessoa não encontrada');

    const token = generatePortalToken();
    const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_MS);
    person.set('shareToken', undefined);
    person.shareTokenHash = hashPortalToken(token);
    person.shareTokenExpiresAt = expiresAt;
    person.shareTokenRevokedAt = null;
    await person.save();
    await recordAuditEvent({
      eventType: 'share.link.created',
      actorUserId: req.user._id,
      targetUserId: req.user._id,
      targetId: String(person._id),
      requestId: req.id,
    });
    res.set('Cache-Control', 'no-store').json({ data: { token, expiresAt } });
  }));
  r.delete('/:id/share-link', requireRecentAuth(), validate({ params: idParam }), asyncHandler(async (req, res) => {
    const person = await Person.findOne({ _id: req.params.id, userId: req.user._id });
    if (!person) throw notFound('Pessoa não encontrada');
    person.set('shareToken', undefined);
    person.shareTokenHash = undefined;
    person.shareTokenExpiresAt = null;
    person.shareTokenRevokedAt = new Date();
    await person.save();
    await recordAuditEvent({
      eventType: 'share.link.revoked',
      actorUserId: req.user._id,
      targetUserId: req.user._id,
      targetId: String(person._id),
      requestId: req.id,
    });
    res.status(204).end();
  }));
  r.put('/:id', validate({ params: idParam, body }), asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    let updated;
    try {
      await session.withTransaction(async () => {
        const current = await Person.findOne({ _id: req.params.id, userId: req.user._id })
          .select('+shareTokenHash')
          .session(session);
        if (!current) throw notFound('Pessoa não encontrada');
        current.name = req.body.name;
        for (const key of ['phone', 'email', 'birthDate', 'pixKey', 'avatar', 'notes']) {
          if (req.body[key] !== undefined) current[key] = key === 'email'
            ? (req.body[key] ? req.body[key].toLowerCase() : null)
            : (req.body[key] || null);
        }
        await current.save({ session });
        await syncBirthday(req.user._id, current, session);
        updated = current.toObject();
      });
    } finally {
      await session.endSession();
    }
    const purchases = await Purchase.countDocuments({ userId: req.user._id, personId: req.params.id });
    res.json({ data: personJson(updated, purchases) });
  }));
  r.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const personId = req.params.id;
    const used = await VehicleExpense.exists({
      userId: req.user._id,
      $or: [{ payerId: personId }, { 'shares.personId': personId }],
    });
    if (used) throw conflict('Esta pessoa tem gastos de veículo registrados. Edite ou exclua esses lançamentos antes de excluí-la.');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const person = await Person.findOne({ _id: personId, userId: req.user._id }).session(session);
        if (!person) throw notFound('Pessoa não encontrada');
        const purchases = await Purchase.find({ userId: req.user._id, personId }).select('_id').session(session);
        if (purchases.length) {
          await Installment.deleteMany({ userId: req.user._id, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
          await Purchase.deleteMany({ _id: { $in: purchases.map((item) => item._id) }, userId: req.user._id }, { session });
        }
        await BudgetSheet.deleteMany({ userId: req.user._id, personId }, { session });
        await MonthStatus.deleteMany({ userId: req.user._id, personId }, { session });
        await Birthday.deleteMany({ userId: req.user._id, personId }, { session });
        await CashEntry.updateMany({ userId: req.user._id, personId }, { $set: { personId: null } }, { session });
        await Card.updateMany({ userId: req.user._id, ownerId: personId }, { $set: { ownerId: null } }, { session });
        await Vehicle.updateMany({ userId: req.user._id, ownerId: personId }, { $set: { ownerId: null } }, { session });
        await User.updateOne(
          { _id: req.user._id, portalContactPersonId: personId },
          { $set: { portalContactPersonId: null } },
          { session },
        );
        await person.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    res.status(204).end();
  }));
  return r;
}
