import { Router } from 'express';
import multer from 'multer';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { createVehiclesService } from './vehicles.service.js';
import { detectImageContentType } from './vehicle-files.validation.js';
import { CATEGORY_KEYS, GROUP_KEYS } from './vehicles.categories.js';
import {
  createVehicleReminder, listVehicleReminders, markVehicleReminderPaid,
  getVehicleReminderSettings, removeVehicleReminder, saveVehicleReminderSettings, updateVehicleReminder,
} from './vehicle-reminders.service.js';
import { detectVehicleDocumentContentType } from './vehicle-documents.validation.js';
import {
  createVehicleDocument, getVehicleDocumentFile, listVehicleDocuments, removeVehicleDocument,
} from './vehicle-documents.service.js';

const id = z.string().regex(/^[\da-f]{24}$/i);
const optId = id.optional();
const idParam = z.object({ id });
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
}).fields([{ name: 'photo', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('file');

function handlePhotoUpload(req, res, next) {
  photoUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(badRequest('Cada imagem deve ter até 5 MB.'));
    }
    if (error instanceof multer.MulterError) return next(badRequest('Envie somente a foto e sua miniatura.'));
    return next(error);
  });
}
function handleDocumentUpload(req, res, next) {
  documentUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(badRequest('O documento deve ter até 10 MB.'));
    }
    if (error instanceof multer.MulterError) return next(badRequest('Envie somente um arquivo.'));
    return next(error);
  });
}

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
  currentKm: z.coerce.number().int().min(0).max(5_000_000).nullable().optional(),
  insuranceDueDate: realDate.nullable().optional(),
  ownerId: id.nullable().optional(),
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
    liters: z.coerce.number().positive().max(1_000).optional(),
    payerId: id,
    shared: z.boolean().default(false),
    paymentMethod: z.enum(['cash', 'card']).default('cash'),
    cardId: optId,
    installmentCount: z.coerce.number().int().min(1).max(120).default(1),
    recurrenceType: z.enum(['once', 'installments', 'ongoing']).default('once'),
    recurrenceCount: z.coerce.number().int().min(2).max(240).optional(),
    startMonth: z.coerce.number().int().min(1).max(12).optional(),
    startYear: z.coerce.number().int().min(2000).max(2100).optional(),
    requestId: z.string().uuid().optional(),
    reminderId: optId,
    splitMode: z.enum(['equal', 'percent', 'amount']).default('equal'),
    participantIds: z.array(id).max(20).optional(),
    participants: z.array(z.object({ personId: id, value: z.coerce.number().positive().max(10_000_000).optional() })).max(20).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.paymentMethod === 'card' && !b.cardId) {
      ctx.addIssue({ code: 'custom', message: 'Escolha o cartão', path: ['cardId'] });
    }
    if (b.paymentMethod === 'card' && b.recurrenceType !== 'once') {
      ctx.addIssue({ code: 'custom', message: 'A recorrência mensal não se aplica a despesas no cartão', path: ['recurrenceType'] });
    }
    if (b.recurrenceType === 'installments' && !b.recurrenceCount) {
      ctx.addIssue({ code: 'custom', message: 'Informe a quantidade de parcelas mensais', path: ['recurrenceCount'] });
    }
    if (b.category !== 'fuel' && b.liters != null) {
      ctx.addIssue({ code: 'custom', message: 'Litros só podem ser informados em gastos de combustível', path: ['liters'] });
    }
    if (!b.shared) return;
    const list = b.participants ?? (b.participantIds || []).map((personId) => ({ personId }));
    const fail = (message) => ctx.addIssue({ code: 'custom', message, path: ['participants'] });
    if (list.length < 2) return fail('Escolha pelo menos 2 participantes');
    if (new Set(list.map((p) => p.personId)).size !== list.length) return fail('Participantes repetidos');
    if (b.splitMode !== 'equal' && list.some((p) => !(p.value > 0))) fail('Informe a parte de cada participante');
  })
  .transform((b) => {
    const { participantIds, participants, ...rest } = b;
    return {
      ...rest,
      recurrenceCount: rest.recurrenceType === 'installments' ? rest.recurrenceCount : null,
      participants: rest.shared ? participants ?? (participantIds || []).map((personId) => ({ personId })) : [],
    };
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
const summaryQuery = z.object({
  vehicleId: optId,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  period: z.enum(['month', 'quarter', 'year', 'all']).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
const reminderQuery = z.object({ vehicleId: optId });
const reminderBody = z.object({
  vehicleId: id,
  type: z.enum(['oil', 'tires', 'review', 'ipva', 'insurance', 'licensing', 'other']),
  title: z.string().trim().max(80).optional(),
  rule: z.enum(['km', 'time', 'km_or_time', 'fixed_date']),
  intervalKm: z.coerce.number().int().min(1).max(5_000_000).nullable().optional(),
  intervalMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  dueDate: realDate.nullable().optional(),
  lastPerformedDate: realDate.nullable().optional(),
  lastPerformedKm: z.coerce.number().int().min(0).max(5_000_000).nullable().optional(),
}).superRefine((reminder, ctx) => {
  if (['km', 'km_or_time'].includes(reminder.rule) && !reminder.intervalKm) {
    ctx.addIssue({ code: 'custom', message: 'Informe o intervalo em km.', path: ['intervalKm'] });
  }
  if (['time', 'km_or_time'].includes(reminder.rule) && !reminder.intervalMonths) {
    ctx.addIssue({ code: 'custom', message: 'Informe o intervalo em meses.', path: ['intervalMonths'] });
  }
  if (reminder.rule === 'fixed_date' && !reminder.dueDate) {
    ctx.addIssue({ code: 'custom', message: 'Informe a data de vencimento.', path: ['dueDate'] });
  }
  if (reminder.type === 'other' && !reminder.title?.trim()) {
    ctx.addIssue({ code: 'custom', message: 'Informe o nome do lembrete.', path: ['title'] });
  }
});
const reminderSettingsBody = z.object({
  daysBefore: z.coerce.number().int().min(0).max(365),
  kmBefore: z.coerce.number().int().min(0).max(100_000),
});
const documentBody = z.object({
  vehicleId: id,
  name: z.string().trim().min(1).max(100),
  type: z.enum(['crlv', 'policy', 'purchase_invoice', 'other']),
  dueDate: realDate.optional(),
});

export function vehiclesRoutes() {
  const r = Router();
  const svc = createVehiclesService();

  r.get('/categories', (_req, res) => res.json({ data: svc.categories() }));
  r.get('/summary', validate({ query: summaryQuery }), asyncHandler(async (req, res) => res.json({ data: await svc.summary(req.user._id, req.query) })));
  r.get('/maintenance', validate({ query: reminderQuery }), asyncHandler(async (req, res) => {
    res.json({ data: await listVehicleReminders(req.user._id, req.query.vehicleId) });
  }));
  r.get('/maintenance/settings', asyncHandler(async (req, res) => {
    res.json({ data: await getVehicleReminderSettings(req.user._id) });
  }));
  r.put('/maintenance/settings', validate({ body: reminderSettingsBody }), asyncHandler(async (req, res) => {
    res.json({ data: await saveVehicleReminderSettings(req.user._id, req.body) });
  }));
  r.post('/maintenance', validate({ body: reminderBody }), asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createVehicleReminder(req.user._id, req.body) });
  }));
  r.put('/maintenance/:id', validate({ params: idParam, body: reminderBody }), asyncHandler(async (req, res) => {
    res.json({ data: await updateVehicleReminder(req.user._id, req.params.id, req.body) });
  }));
  r.post('/maintenance/:id/paid', validate({ params: idParam }), asyncHandler(async (req, res) => {
    res.json({ data: await markVehicleReminderPaid(req.user._id, req.params.id) });
  }));
  r.delete('/maintenance/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    await removeVehicleReminder(req.user._id, req.params.id);
    res.status(204).end();
  }));
  r.get('/documents', validate({ query: reminderQuery }), asyncHandler(async (req, res) => {
    res.json({ data: await listVehicleDocuments(req.user._id, req.query.vehicleId) });
  }));
  r.post('/documents', handleDocumentUpload, validate({ body: documentBody }), asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Selecione um arquivo PDF ou imagem.');
    const contentType = detectVehicleDocumentContentType(file.buffer);
    if (!contentType || contentType !== file.mimetype) throw badRequest('Use um arquivo PDF, JPG, PNG ou WebP válido.');
    res.status(201).json({ data: await createVehicleDocument(req.user._id, req.body, file, contentType) });
  }));
  const sendDocumentFile = (download) => asyncHandler(async (req, res) => {
    const { file, stream, document } = await getVehicleDocumentFile(req.user._id, req.params.id);
    const filename = document.originalName.replace(/[^\w.-]/g, '_');
    res.set({
      'Content-Type': document.contentType,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(stream, res);
  });
  r.get('/documents/:id/file', validate({ params: idParam }), sendDocumentFile(false));
  r.get('/documents/:id/download', validate({ params: idParam }), sendDocumentFile(true));
  r.delete('/documents/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    await removeVehicleDocument(req.user._id, req.params.id);
    res.status(204).end();
  }));
  r.post('/:id/photo', validate({ params: idParam }), handlePhotoUpload, asyncHandler(async (req, res) => {
    const image = req.files?.photo?.[0];
    const thumbnail = req.files?.thumbnail?.[0];
    if (!image || !thumbnail) throw badRequest('Envie a foto e sua miniatura.');
    const imageType = detectImageContentType(image.buffer);
    const thumbnailType = detectImageContentType(thumbnail.buffer);
    if (!imageType || imageType !== image.mimetype || !thumbnailType || thumbnailType !== thumbnail.mimetype) {
      throw badRequest('Use uma imagem JPG, PNG ou WebP válida.');
    }
    res.json({ data: await svc.updateVehiclePhoto(req.user._id, req.params.id, {
      buffer: image.buffer, contentType: imageType,
    }, {
      buffer: thumbnail.buffer, contentType: thumbnailType,
    }) });
  }));
  r.delete('/:id/photo', validate({ params: idParam }), asyncHandler(async (req, res) => {
    await svc.removeVehiclePhoto(req.user._id, req.params.id);
    res.status(204).end();
  }));
  r.get('/:id/photo', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const { file, stream } = await svc.getVehiclePhoto(req.user._id, req.params.id);
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    await pipeline(stream, res);
  }));
  r.get('/:id/photo/thumbnail', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const { file, stream } = await svc.getVehiclePhoto(req.user._id, req.params.id, true);
    res.set({ 'Content-Type': file.contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    await pipeline(stream, res);
  }));

  // Lançamentos (declarados antes de /:id para não colidir)
  r.get('/expenses/export.csv', validate({ query: exportQuery }), asyncHandler(async (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="gastos-veiculos.csv"');
    res.send('﻿' + await svc.exportCsv(req.user._id, req.query));
  }));
  r.get('/expenses', validate({ query: listQuery }), asyncHandler(async (req, res) => res.json(await svc.listExpenses(req.user._id, req.query))));
  r.get('/expenses/:id', validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ data: await svc.getExpense(req.user._id, req.params.id) })));
  r.post('/expenses', validate({ body: expenseBody }), asyncHandler(async (req, res) => res.status(201).json({ data: await svc.createExpense(req.user._id, req.body) })));
  r.put('/expenses/:id', validate({ params: idParam, body: expenseBody }), asyncHandler(async (req, res) => res.json({ data: await svc.updateExpense(req.user._id, req.params.id, req.body) })));
  r.delete('/expenses/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
    await svc.removeExpense(req.user._id, req.params.id);
    res.status(204).end();
  }));

  // Veículos (ficha)
  r.get('/', asyncHandler(async (req, res) => res.json({ data: await svc.listVehicles(req.user._id) })));
  r.post('/', validate({ body: vehicleBody }), asyncHandler(async (req, res) => res.status(201).json({ data: await svc.createVehicle(req.user._id, req.body) })));
  r.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => res.json({ data: await svc.getVehicle(req.user._id, req.params.id) })));
  r.put('/:id', validate({ params: idParam, body: vehicleBody }), asyncHandler(async (req, res) => res.json({ data: await svc.updateVehicle(req.user._id, req.params.id, req.body) })));
  r.delete('/:id', validate({ params: idParam, query: z.object({ force: bool.optional() }) }), asyncHandler(async (req, res) => {
    await svc.removeVehicle(req.user._id, req.params.id, Boolean(req.query.force));
    res.status(204).end();
  }));
  return r;
}
