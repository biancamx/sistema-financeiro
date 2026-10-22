import { Router } from 'express';
import { z } from 'zod';
import { Category } from '../../models/Category.js';
import { CashEntry } from '../../models/CashEntry.js';
import { Purchase } from '../../models/Purchase.js';
import mongoose from 'mongoose';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';

const body = z.object({ name: z.string().trim().min(1).max(80) });
const idParam = z.object({ id: z.string().regex(/^[\da-f]{24}$/i) });

export function categoriesRoutes() {
  const r = Router();
  r.get('/', asyncHandler(async (req, res) => {
    const categories = await Category.find({ userId: req.user._id }).sort({ name: 1 }).lean();
    res.json({ data: categories.map(({ _id, name }) => ({ id: String(_id), name })) });
  }));
  r.post('/', validate({ body }), asyncHandler(async (req, res) => {
    const category = await Category.create({ userId: req.user._id, name: req.body.name });
    res.status(201).json({ data: { id: String(category._id), name: category.name } });
  }));
  r.put('/:id', validate({ params: idParam, body }), asyncHandler(async (req, res) => {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name: req.body.name },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!category) throw notFound('Categoria não encontrada');
    res.json({ data: { id: String(category._id), name: category.name } });
  }));
  r.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const category = await Category.findOne({ _id: req.params.id, userId: req.user._id }).session(session);
        if (!category) throw notFound('Categoria não encontrada');
        await Purchase.updateMany(
          { userId: req.user._id, categoryId: category._id },
          { $set: { categoryId: null } },
          { session },
        );
        await CashEntry.updateMany(
          { userId: req.user._id, categoryId: category._id },
          { $set: { categoryId: null } },
          { session },
        );
        await category.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    res.status(204).end();
  }));
  return r;
}
