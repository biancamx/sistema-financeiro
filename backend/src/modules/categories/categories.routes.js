import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Category } from '../../models/Category.js';
import { CashEntry } from '../../models/CashEntry.js';
import { Purchase } from '../../models/Purchase.js';
import { User } from '../../models/User.js';
import { AppError, asyncHandler, conflict, notFound } from '../../lib/errors.js';
import { importPreviewLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { importCategoryNames, previewCategoriesPdf } from './category-import.service.js';

const DEFAULT_CATEGORIES = [
  ...['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Compras', 'Contas e serviços', 'Veículo', 'Outros']
    .map((name) => ({ name, type: 'expense' })),
  { name: 'Renda extra', type: 'income' },
  { name: 'Geral', type: 'both' },
];

const body = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['expense', 'income', 'both']).default('both'),
  color: z.string().regex(/^#[\da-f]{6}$/i, 'A cor deve estar no formato hexadecimal.').default('#10b981'),
  icon: z.string().trim().min(1).max(40).default('Tag'),
});
const idParam = z.object({ id: z.string().regex(/^[\da-f]{24}$/i) });
const importNamesBody = z.object({
  names: z.array(z.string().trim().min(1).max(80)).min(1).max(100),
});
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 14 * 1024 * 1024 },
});

function uploadCategoryPdf(req, res, next) {
  pdfUpload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'CATEGORY_PDF_TOO_LARGE', 'O PDF deve ter no máximo 14 MB.'));
    }
    if (error) return next(error);
    return next();
  });
}

function serialize(category) {
  return {
    id: String(category._id),
    name: category.name,
    type: category.type ?? 'both',
    color: category.color ?? '#10b981',
    icon: category.icon ?? 'Tag',
  };
}

async function ensureDefaultCategories(userId) {
  const initializationClaim = await User.findOneAndUpdate(
    { _id: userId, categoriesInitialized: { $ne: true } },
    { $set: { categoriesInitialized: true } },
    { returnDocument: 'after' },
  ).select('_id').lean();
  if (!initializationClaim) return;

  try {
    await Category.bulkWrite(DEFAULT_CATEGORIES.map(({ name, type }) => ({
      updateOne: {
        filter: { userId, name },
        update: {
          $setOnInsert: { userId, name, type, color: '#10b981', icon: 'Tag' },
        },
        upsert: true,
      },
    })));
  } catch (error) {
    await User.updateOne({ _id: userId }, { $set: { categoriesInitialized: false } });
    throw error;
  }
}

export function categoriesRoutes() {
  const r = Router();
  r.get('/', asyncHandler(async (req, res) => {
    await ensureDefaultCategories(req.user._id);
    const categories = await Category.find({ userId: req.user._id }).sort({ name: 1 }).lean();
    res.json({ data: categories.map(serialize) });
  }));
  r.post('/import/preview', importPreviewLimiter, uploadCategoryPdf, asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, 'CATEGORY_PDF_REQUIRED', 'Selecione um arquivo PDF.');
    await ensureDefaultCategories(req.user._id);
    const data = await previewCategoriesPdf(req.user._id, req.file.buffer);
    res.json({ data });
  }));
  r.post('/import', validate({ body: importNamesBody }), asyncHandler(async (req, res) => {
    await ensureDefaultCategories(req.user._id);
    const summary = await importCategoryNames(req.user._id, req.body.names);
    res.status(201).json({ data: summary });
  }));
  r.post('/', validate({ body }), asyncHandler(async (req, res) => {
    const category = await Category.create({ userId: req.user._id, ...req.body });
    res.status(201).json({ data: serialize(category) });
  }));
  r.put('/:id', validate({ params: idParam, body }), asyncHandler(async (req, res) => {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!category) throw notFound('Categoria não encontrada');
    res.json({ data: serialize(category) });
  }));
  r.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const category = await Category.findOne({ _id: req.params.id, userId: req.user._id });
    if (!category) throw notFound('Categoria não encontrada');
    const [hasPurchases, hasCashEntries] = await Promise.all([
      Purchase.exists({ userId: req.user._id, categoryId: category._id }),
      CashEntry.exists({ userId: req.user._id, categoryId: category._id }),
    ]);
    if (hasPurchases || hasCashEntries) {
      throw conflict('Esta categoria está vinculada a lançamentos e não pode ser excluída.');
    }
    await category.deleteOne();
    res.status(204).end();
  }));
  return r;
}
