import mongoose from 'mongoose';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { Installment } from '../../models/Installment.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { User } from '../../models/User.js';
import { dismissSystemAlert, getSystemAlerts } from './alerts.service.js';
import { getPersonBillingSummary } from './reminders.service.js';

const period = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const personParam = z.object({ personId: z.string().regex(/^[\da-f]{24}$/i) });
const settlePersonMonthBody = z.object({
  personId: z.string().regex(/^[\da-f]{24}$/i),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
const reminderSettingsBody = z.object({
  trigger_day: z.coerce.number().int().min(1).max(31),
  trigger_hour: z.coerce.number().int().min(0).max(23),
  enabled: z.boolean(),
});
const dismissAlertBody = z.object({
  alertKey: z.string().regex(/^[\da-f]{64}$/i),
});

export function remindersRoutes() {
  const router = Router();
  const jsonSettings = (userId, settings) => ({
    user_id: String(userId),
    enabled: settings?.enabled === false ? 0 : 1,
    trigger_day: settings?.triggerDay ?? 5,
    trigger_hour: settings?.triggerHour ?? 9,
  });
  router.get('/settings', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('reminderSettings').lean();
    const settings = jsonSettings(req.user._id, user?.reminderSettings);
    res.json({ data: settings, ...settings });
  }));
  router.put('/settings', validate({ body: reminderSettingsBody }), asyncHandler(async (req, res) => {
    const { trigger_day: triggerDay, trigger_hour: triggerHour, enabled } = req.body;
    const result = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { 'reminderSettings.triggerDay': triggerDay, 'reminderSettings.triggerHour': triggerHour, 'reminderSettings.enabled': enabled } },
      { returnDocument: 'after', runValidators: true },
    ).select('reminderSettings').lean();
    const settings = jsonSettings(req.user._id, result?.reminderSettings);
    res.json({ data: settings, ...settings, success: true });
  }));
  router.get('/alerts', asyncHandler(async (req, res) => res.json(await getSystemAlerts(req.user._id))));
  router.post('/alerts/dismiss', validate({ body: dismissAlertBody }), asyncHandler(async (req, res) => {
    await dismissSystemAlert(req.user._id, req.body.alertKey);
    res.json({ success: true });
  }));
  router.post('/settle-person-month', validate({ body: settlePersonMonthBody }), asyncHandler(async (req, res) => {
    const { personId, month, year } = req.body;
    if (!await Person.exists({ _id: personId, userId: req.user._id })) return res.status(404).json({ error: 'Pessoa não encontrada' });
    const session = await mongoose.startSession();
    let settledCount = 0;
    try {
      await session.withTransaction(async () => {
        const purchases = await Purchase.find({ userId: req.user._id, personId }).select('_id').session(session);
        const installments = purchases.length ? await Installment.find({
          userId: req.user._id, purchaseId: { $in: purchases.map((purchase) => purchase._id) }, month, year, paid: false,
        }).session(session) : [];
        for (const installment of installments) {
          installment.paid = true;
          installment.paidAmount = installment.amount;
          await installment.save({ session });
        }
        settledCount = installments.length;
        await MonthStatus.findOneAndUpdate(
          { userId: req.user._id, personId, year, month },
          { $set: { status: 'paid' }, $setOnInsert: { userId: req.user._id, personId, year, month } },
          { upsert: true, runValidators: true, setDefaultsOnInsert: true, session },
        );
      });
    } finally { await session.endSession(); }
    res.json({
      success: true,
      message: `${settledCount} parcela(s) quitada(s); despesas da planilha marcadas como pagas.`,
      settledCount,
    });
  }));
  router.get('/billing/:personId', validate({ params: personParam, query: period }), asyncHandler(async (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const summary = await getPersonBillingSummary(req.user._id, req.params.personId, month, year);
    if (!summary) return res.status(404).json({ error: 'Pessoa não encontrada' });
    res.json(summary);
  }));
  router.get('/monthly-summary', validate({ query: period }), asyncHandler(async (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const people = await Person.find({ userId: req.user._id }).select('_id').sort({ name: 1 }).lean();
    const summaries = await Promise.all(people.map((person) => getPersonBillingSummary(req.user._id, person._id, month, year)));
    res.json({ month, year, people: summaries.filter((summary) => summary && summary.totalAmount > 0) });
  }));
  return router;
}
