import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { createCardBilling } from '../../lib/cardBilling.js';
import { getSystemAlerts } from './alerts.service.js';
import { getPersonBillingSummary } from './reminders.service.js';

const period = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const personParam = z.object({ personId: z.coerce.number().int().positive() });
const settlePersonMonthBody = z.object({
  personId: z.coerce.number().int().positive(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
const reminderSettingsBody = z.object({
  trigger_day: z.number().int().min(1).max(31),
  trigger_hour: z.number().int().min(0).max(23),
  enabled: z.boolean(),
});

export function remindersRoutes(db) {
  const router = Router();
  const billing = createCardBilling(db);

  // Buscar configuração de lembretes (com fallback seguro contra travamento)
  router.get('/settings', (req, res) => {
    try {
      let settings = null;
      try {
        settings = db.prepare('SELECT * FROM reminder_settings WHERE user_id = ?').get(req.user.id);
      } catch (tableErr) {
        // Se a tabela ainda não existir, cria na hora
        db.exec(`
          CREATE TABLE IF NOT EXISTS reminder_settings (
            user_id INTEGER PRIMARY KEY,
            enabled INTEGER DEFAULT 1,
            trigger_day INTEGER DEFAULT 5,
            trigger_hour INTEGER DEFAULT 9,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }

      if (!settings) {
        settings = { user_id: req.user.id, trigger_day: 5, trigger_hour: 9, enabled: 1 };
      }

      res.json({ data: settings, ...settings });
    } catch (err) {
      console.error('Erro ao buscar configurações:', err);
      // Retorna valores padrão para NUNCA travar o front em "Carregando..."
      const fallback = { user_id: req.user.id, trigger_day: 5, trigger_hour: 9, enabled: 1 };
      res.json({ data: fallback, ...fallback });
    }
  });

  // Salvar configuração de lembretes
  router.put('/settings', (req, res) => {
    try {
      const { trigger_day, trigger_hour, enabled } = req.body;
      const day = Math.min(31, Math.max(1, parseInt(trigger_day, 10) || 5));
      const hour = Math.min(23, Math.max(0, parseInt(trigger_hour, 10) || 9));
      const isEnabled = enabled ? 1 : 0;

      try {
        db.prepare(`
          INSERT INTO reminder_settings (user_id, trigger_day, trigger_hour, enabled)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            trigger_day = excluded.trigger_day,
            trigger_hour = excluded.trigger_hour,
            enabled = excluded.enabled
        `).run(req.user.id, day, hour, isEnabled);
      } catch (tableErr) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS reminder_settings (
            user_id INTEGER PRIMARY KEY,
            enabled INTEGER DEFAULT 1,
            trigger_day INTEGER DEFAULT 5,
            trigger_hour INTEGER DEFAULT 9,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        db.prepare(`
          INSERT INTO reminder_settings (user_id, trigger_day, trigger_hour, enabled)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            trigger_day = excluded.trigger_day,
            trigger_hour = excluded.trigger_hour,
            enabled = excluded.enabled
        `).run(req.user.id, day, hour, isEnabled);
      }

      const saved = { success: true, trigger_day: day, trigger_hour: hour, enabled: isEnabled };
      res.json({ data: saved, ...saved });
    } catch (err) {
      console.error('Erro ao salvar configurações:', err);
      res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
  });

  router.get('/alerts', (req, res) => {
    res.json(getSystemAlerts(db, req.user.id));
  });

  router.post('/settle-person-month', validate({ body: settlePersonMonthBody }), (req, res) => {
    const { personId, month, year } = req.body;
    const person = db.prepare('SELECT 1 FROM people WHERE id = ? AND user_id = ?').get(personId, req.user.id);
    if (!person) return res.status(404).json({ error: 'Pessoa não encontrada' });

    const result = db.transaction(() => {
      const installmentIds = db.prepare(
        `SELECT i.id FROM installments i JOIN purchases p ON p.id = i.purchase_id
         WHERE p.user_id = ? AND p.person_id = ? AND i.month = ? AND i.year = ? AND i.paid = 0`,
      ).all(req.user.id, personId, month, year).map((item) => item.id);
      const installments = installmentIds.length
        ? billing.recordBulkPayment(req.user.id, installmentIds, true).updated
        : 0;
      db.prepare(
        `INSERT INTO month_status (user_id, person_id, year, month, status)
         VALUES (?, ?, ?, ?, 'paid')
         ON CONFLICT(user_id, person_id, year, month) DO UPDATE SET status = 'paid'`,
      ).run(req.user.id, personId, year, month);

      return installments;
    })();

    res.json({
      success: true,
      message: `${result} parcela(s) quitada(s); despesas da planilha marcadas como pagas.`,
      settledCount: result,
    });
  });

  router.get('/billing/:personId', validate({ params: personParam, query: period }), (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const summary = getPersonBillingSummary(db, req.user.id, req.params.personId, month, year);
    if (!summary) return res.status(404).json({ error: 'Pessoa não encontrada' });
    res.json(summary);
  });

  router.get('/monthly-summary', validate({ query: period }), (req, res) => {
    const now = new Date();
    const month = req.query.month ?? now.getMonth() + 1;
    const year = req.query.year ?? now.getFullYear();
    const people = db.prepare('SELECT id FROM people WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(req.user.id);
    const summaries = people
      .map((person) => getPersonBillingSummary(db, req.user.id, person.id, month, year))
      .filter((summary) => summary && summary.totalAmount > 0);

    res.json({ month, year, people: summaries });
  });

  return router;
}
