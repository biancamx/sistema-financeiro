import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { Birthday } from '../../models/Birthday.js';
import { Person } from '../../models/Person.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';

const body = z.object({
  name: z.string().trim().min(1).max(80),
  day: z.coerce.number().int().min(1).max(31),
  month: z.coerce.number().int().min(1).max(12),
});
const idParam = z.object({ id: z.string().regex(/^[\da-f]{24}$/i) });

export function birthdaysRoutes() {
  const r = Router();
  r.get('/', asyncHandler(async (req, res) => {
    const birthdays = await Birthday.find({ userId: req.user._id }).sort({ month: 1, day: 1 }).lean();
    res.json({
      data: birthdays.map(({ _id, name, day, month, personId }) => ({
        id: String(_id), name, day, month, personId: personId ? String(personId) : null,
      })),
    });
  }));
  r.post('/', validate({ body }), asyncHandler(async (req, res) => {
    const birthday = await Birthday.create({ userId: req.user._id, ...req.body });
    res.status(201).json({
      data: { id: String(birthday._id), name: birthday.name, day: birthday.day, month: birthday.month },
    });
  }));
  r.put('/:id', validate({ params: idParam, body }), asyncHandler(async (req, res) => {
    const birthday = await Birthday.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!birthday) throw notFound('Aniversário não encontrado');
    res.json({
      data: { id: String(birthday._id), name: birthday.name, day: birthday.day, month: birthday.month },
    });
  }));
  r.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const birthday = await Birthday.findOne({ _id: req.params.id, userId: req.user._id }).session(session);
        if (!birthday) throw notFound('Aniversário não encontrado');
        if (birthday.personId) {
          await Person.updateOne(
            { _id: birthday.personId, userId: req.user._id },
            { $set: { birthDate: null } },
            { session },
          );
        }
        await birthday.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    res.status(204).end();
  }));
  return r;
}
