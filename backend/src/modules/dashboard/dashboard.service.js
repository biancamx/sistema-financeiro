import { monthIndex, round2 } from '../../lib/months.js';
import { badRequest } from '../../lib/errors.js';
import { createBudgetsService } from '../budgets/budgets.service.js';

export function createDashboardService(db) {
  const budgets = createBudgetsService(db);
  return {
    /** Aba "Dashboard" + "dahbord cartoes": tudo que a tela inicial precisa em uma chamada */
    summary(userId, { month, year, personId }) {
      const idx = monthIndex(year, month);
      const sum = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));

      // "Total de cada Cartão" no mês (todas as pessoas)
      const cardTotals = db
        .prepare(
          `SELECT c.id, c.name, c.limit_amount AS "limit",
             COALESCE((SELECT SUM(i.amount) FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE p.card_id = c.id AND i.year = ? AND i.month = ?), 0) AS amount,
             COALESCE((SELECT SUM(i.amount) FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE p.card_id = c.id AND (i.year * 12 + i.month) >= ?), 0) AS used
           FROM cards c WHERE c.user_id = ? ORDER BY c.name COLLATE NOCASE`,
        )
        .all(year, month, idx, userId)
        .map((c) => ({ ...c, amount: round2(c.amount), used: round2(c.used), available: round2(c.limit - c.used) }));

      // Quanto cada pessoa deve no mês e daqui para frente + último mês de pagamento
      const people = db
        .prepare(
          `SELECT pe.id, pe.name,
             COALESCE((SELECT SUM(i.amount) FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE p.person_id = pe.id AND i.year = ? AND i.month = ?), 0) AS month,
             COALESCE((SELECT SUM(i.amount) FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE p.person_id = pe.id AND (i.year * 12 + i.month) >= ?), 0) AS owed,
             (SELECT MAX(i.year * 12 + i.month) FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE p.person_id = pe.id) AS lastIdx
           FROM people pe WHERE pe.user_id = ? ORDER BY pe.name COLLATE NOCASE`,
        )
        .all(year, month, idx, userId)
        .map((p) => ({
          id: p.id, name: p.name, month: round2(p.month), owed: round2(p.owed),
          lastPayment: p.lastIdx ? { year: Math.floor((p.lastIdx - 1) / 12), month: ((p.lastIdx - 1) % 12) + 1 } : null,
        }));

      // Bloco "Pessoa / Mês / Ano": faturas da pessoa escolhida por cartão
      let person = null;
      const chosen = personId ?? people.find((p) => p.month > 0)?.id ?? people[0]?.id;
      if (chosen) {
        const cards = db
          .prepare(
            `SELECT c.id, c.name, COALESCE(SUM(i.amount), 0) AS amount
             FROM cards c LEFT JOIN purchases p ON p.card_id = c.id AND p.person_id = ?
             LEFT JOIN installments i ON i.purchase_id = p.id AND i.year = ? AND i.month = ?
             WHERE c.user_id = ? GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
          )
          .all(chosen, year, month, userId)
          .map((c) => ({ ...c, amount: round2(c.amount) }));
        person = { id: chosen, name: people.find((p) => p.id === chosen)?.name, cards, total: sum(cards) };
      }

      // Série do ano (12 meses), para o gráfico
      const yearRows = db
        .prepare('SELECT month, SUM(amount) AS amount FROM installments WHERE user_id = ? AND year = ? GROUP BY month')
        .all(userId, year);
      const series = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, amount: round2(yearRows.find((r) => r.month === m + 1)?.amount ?? 0) }));

      const byCategory = db
        .prepare(
          `SELECT COALESCE(cat.name, 'Sem categoria') AS name, SUM(i.amount) AS amount
           FROM installments i JOIN purchases p ON p.id = i.purchase_id LEFT JOIN categories cat ON cat.id = p.category_id
           WHERE i.user_id = ? AND i.year = ? AND i.month = ? GROUP BY cat.id ORDER BY amount DESC LIMIT 8`,
        )
        .all(userId, year, month)
        .map((c) => ({ name: c.name, amount: round2(c.amount) }));

      return {
        period: { month, year },
        totals: { month: sum(cardTotals), owed: round2(people.reduce((s, p) => s + p.owed, 0)), limit: round2(cardTotals.reduce((s, c) => s + c.limit, 0)), available: round2(cardTotals.reduce((s, c) => s + c.available, 0)) },
        cardTotals, people, person, series, byCategory,
      };
    },

    /** Aba "financeiro geral": matriz cartão x 12 meses de uma pessoa + status pendente/pago */
    personOverview(userId, personId, year) {
      const person = db.prepare('SELECT id, name FROM people WHERE id = ? AND user_id = ?').get(personId, userId);
      if (!person) throw badRequest('Pessoa inválida');
      const rows = db
        .prepare(
          `SELECT c.id, c.name, i.month, SUM(i.amount) AS amount
           FROM installments i JOIN purchases p ON p.id = i.purchase_id JOIN cards c ON c.id = p.card_id
           WHERE p.user_id = ? AND p.person_id = ? AND i.year = ? GROUP BY c.id, i.month ORDER BY c.name COLLATE NOCASE`,
        )
        .all(userId, personId, year);
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.id)) map.set(r.id, { id: r.id, name: r.name, values: Array(12).fill(0) });
        map.get(r.id).values[r.month - 1] = round2(r.amount);
      }
      const cards = [...map.values()].map((c) => ({ ...c, total: round2(c.values.reduce((a, b) => a + b, 0)) }));

      // Contas fixas (luz, água, internet, veículo…) vêm da planilha mensal da pessoa naquele ano
      const sheetId = budgets.ensureSheet(userId, personId, year);
      const fixedRows = db.prepare("SELECT id, label FROM budget_rows WHERE sheet_id = ? AND section = 'fixed' ORDER BY position, id").all(sheetId);
      const cells = db.prepare("SELECT row_id, month, value FROM budget_cells WHERE row_id IN (SELECT id FROM budget_rows WHERE sheet_id = ? AND section = 'fixed')").all(sheetId);
      const fixed = fixedRows.map((r) => ({ ...r, values: Array(12).fill(0) }));
      const byId = new Map(fixed.map((r) => [r.id, r]));
      for (const c of cells) byId.get(c.row_id).values[c.month - 1] = c.value;
      for (const r of fixed) r.total = round2(r.values.reduce((a, b) => a + b, 0));

      const totals = Array.from({ length: 12 }, (_, m) => round2(cards.reduce((s, c) => s + c.values[m], 0) + fixed.reduce((s, r) => s + r.values[m], 0)));
      const status = Array(12).fill('pending');
      for (const s of db.prepare('SELECT month, status FROM month_status WHERE user_id = ? AND person_id = ? AND year = ?').all(userId, personId, year)) status[s.month - 1] = s.status;
      return { person, year, sheetId, cards, fixed, totals, yearTotal: round2(totals.reduce((a, b) => a + b, 0)), status };
    },

    setStatus(userId, { personId, year, month, status }) {
      if (!db.prepare('SELECT 1 FROM people WHERE id = ? AND user_id = ?').get(personId, userId)) throw badRequest('Pessoa inválida');
      db.prepare(
        'INSERT INTO month_status (user_id, person_id, year, month, status) VALUES (?,?,?,?,?) ON CONFLICT(user_id, person_id, year, month) DO UPDATE SET status = excluded.status',
      ).run(userId, personId, year, month, status);
      return { personId, year, month, status };
    },
  };
}
