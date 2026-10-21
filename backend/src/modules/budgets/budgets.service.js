import { badRequest, notFound } from '../../lib/errors.js';
import { round2 } from '../../lib/months.js';
import { getInstallmentBalanceCents } from '../../lib/cardBilling.js';
import { SECTIONS, SECTION_KEYS, createDefaultRows } from './budgets.defaults.js';
import { createCashLedgerService } from '../cashLedger/cashLedger.service.js';

const zeros = () => Array(12).fill(0);
const sum12 = (arr) => round2(arr.reduce((a, b) => a + b, 0));

export function createBudgetsService(db) {
  const cashLedger = createCashLedgerService(db);
  const owned = (table, id, userId) => db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);

  function ensureSheet(userId, personId, year) {
    if (!owned('people', personId, userId)) throw badRequest('Pessoa inválida');
    let sheet = db.prepare('SELECT id FROM budget_sheets WHERE user_id = ? AND person_id = ? AND year = ?').get(userId, personId, year);
    if (!sheet) {
      db.transaction(() => {
        const id = db.prepare('INSERT INTO budget_sheets (user_id, person_id, year) VALUES (?,?,?)').run(userId, personId, year).lastInsertRowid;
        createDefaultRows(db, userId, id);
        sheet = { id: Number(id) };
      })();
    }
    return sheet.id;
  }

  const rowOwned = (userId, rowId) => {
    const row = db.prepare('SELECT id, sheet_id FROM budget_rows WHERE id = ? AND user_id = ?').get(rowId, userId);
    if (!row) throw notFound('Linha não encontrada');
    return row;
  };

  return {
    ensureSheet,
    /** Anos que já têm planilha para a pessoa */
    years(userId, personId) {
      return db.prepare('SELECT year FROM budget_sheets WHERE user_id = ? AND person_id = ? ORDER BY year').all(userId, personId).map((r) => r.year);
    },

    /** Planilha completa (linhas + células + cartões calculados + resumo geral) */
    getSheet(userId, personId, year, selectedMonth = new Date().getMonth() + 1) {
      const sheetId = ensureSheet(userId, personId, year);
      const rows = db.prepare('SELECT id, section, label, position, receivable_from AS receivableFrom, obs FROM budget_rows WHERE sheet_id = ? ORDER BY position, id').all(sheetId);
      const cells = db.prepare('SELECT row_id, month, value FROM budget_cells WHERE row_id IN (SELECT id FROM budget_rows WHERE sheet_id = ?)').all(sheetId);
      const byRow = new Map(rows.map((r) => [r.id, { ...r, values: zeros(), enteredValues: [] }]));
      for (const c of cells) {
        const row = byRow.get(c.row_id);
        row.values[c.month - 1] = c.value;
        row.enteredValues.push(c.value);
      }

      // Cartões: soma das parcelas da pessoa por cartão e mês (substitui os SUMIFS da planilha)
      const cardRows = db
        .prepare(
          `SELECT c.id AS cardId, c.name AS label, i.month, SUM(i.amount) AS amount
           FROM installments i JOIN purchases p ON p.id = i.purchase_id JOIN cards c ON c.id = p.card_id
           WHERE p.user_id = ? AND p.person_id = ? AND i.year = ? GROUP BY c.id, i.month ORDER BY c.name COLLATE NOCASE`,
        )
        .all(userId, personId, year);
      const cardMap = new Map();
      for (const r of cardRows) {
        if (!cardMap.has(r.cardId)) cardMap.set(r.cardId, { id: `card-${r.cardId}`, section: 'cards', label: r.label, computed: true, values: zeros() });
        cardMap.get(r.cardId).values[r.month - 1] = r.amount;
      }

      const sections = SECTIONS.map((s) => {
        const list = s.computed ? [...cardMap.values()] : [...byRow.values()].filter((r) => r.section === s.key);
        const totals = zeros();
        for (const r of list) r.values.forEach((v, m) => (totals[m] += v));
        return {
          key: s.key,
          label: s.label,
          kind: s.kind,
          computed: Boolean(s.computed),
          rows: list.map((r) => {
            const { enteredValues, ...row } = r;
            const extremes = s.computed || enteredValues.length === 0 ? row.values : enteredValues;
            return {
              ...row,
              total: sum12(row.values),
              min: Math.min(...extremes),
              max: Math.max(...extremes),
            };
          }),
          totals: totals.map(round2),
        };
      });

      const tot = Object.fromEntries(sections.map((s) => [s.key, s.totals]));
      const cashFlow = cashLedger.yearSummary(userId, year);
      const revenue = zeros().map((_, m) => round2(tot.income[m] + tot.benefits[m]));
      const totalRevenue = revenue.map((amount, month) => round2(amount + cashFlow.receipts[month]));
      // "Contas fixas" (as linhas da Visão geral) são um espelho de Moradia/Alimentação/Veículo quando a pessoa já tem a
      // planilha detalhada (Pessoa 01, Pessoa 07): nesse caso não entram de novo no gasto, senão luz/água contariam em dobro.
      const detailed = SECTIONS.some((s) => !s.computed && s.kind === 'expense' && s.key !== 'fixed' && tot[s.key].some((v) => v !== 0));
      const countedSections = SECTIONS.filter((s) => s.kind === 'expense' && !(detailed && s.key === 'fixed'));
      const expenseKeys = countedSections.map((s) => s.key);
      const spent = zeros().map((_, m) => round2(expenseKeys.reduce((a, k) => a + tot[k][m], 0) + cashFlow.expenses[m]));
      const balance = totalRevenue.map((v, m) => round2(v - spent[m]));
      const monthlyPurchases = db.prepare(
        `SELECT i.id AS installmentId, p.id AS purchaseId, p.description, p.observation,
                p.shared_group AS sharedGroup, i.number, p.installments_count AS count,
                i.amount, i.paid, i.paid_amount AS paidAmount, c.id AS cardId, c.name AS card,
                cat.name AS category
         FROM installments i
         JOIN purchases p ON p.id = i.purchase_id
         JOIN cards c ON c.id = p.card_id
         LEFT JOIN categories cat ON cat.id = p.category_id
         WHERE p.user_id = ? AND p.person_id = ? AND i.year = ? AND i.month = ?
         ORDER BY c.name COLLATE NOCASE, cat.name COLLATE NOCASE, p.description COLLATE NOCASE, p.id`,
      ).all(userId, personId, year, selectedMonth).map((purchase) => {
        const amountCents = Math.round(purchase.amount * 100);
        const paidCents = amountCents - getInstallmentBalanceCents(purchase.amount, purchase.paidAmount, purchase.paid);
        return {
          ...purchase,
          paid: Boolean(purchase.paid),
          amount: amountCents / 100,
          paidAmount: paidCents / 100,
          outstanding: Math.max(0, amountCents - paidCents) / 100,
        };
      });
      const monthlyCards = new Map();
      const monthlyCategories = new Map();
      let monthlyPaidCents = 0;
      let monthlyOutstandingCents = 0;
      let monthlyTotalCents = 0;
      for (const purchase of monthlyPurchases) {
        const amountCents = Math.round(purchase.amount * 100);
        const paidCents = Math.round(purchase.paidAmount * 100);
        const outstandingCents = Math.round(purchase.outstanding * 100);
        monthlyTotalCents += amountCents;
        monthlyPaidCents += paidCents;
        monthlyOutstandingCents += outstandingCents;
        const card = monthlyCards.get(purchase.cardId) ?? { id: purchase.cardId, name: purchase.card, totalCents: 0 };
        card.totalCents += amountCents;
        monthlyCards.set(purchase.cardId, card);
        const categoryName = purchase.category || 'Sem categoria';
        const category = monthlyCategories.get(categoryName) ?? { name: categoryName, totalCents: 0 };
        category.totalCents += amountCents;
        monthlyCategories.set(categoryName, category);
      }
      const monthly = {
        month: selectedMonth,
        total: monthlyTotalCents / 100,
        paid: monthlyPaidCents / 100,
        outstanding: monthlyOutstandingCents / 100,
        purchases: monthlyPurchases,
        cards: [...monthlyCards.values()]
          .map(({ totalCents, ...card }) => ({ ...card, total: totalCents / 100 }))
          .sort((a, b) => b.total - a.total),
        categories: [...monthlyCategories.values()]
          .map(({ totalCents, ...category }) => ({ ...category, total: totalCents / 100 }))
          .sort((a, b) => b.total - a.total),
        cash: { expense: cashFlow.expenses[selectedMonth - 1], receipts: cashFlow.receipts[selectedMonth - 1] },
      };
      const summary = {
        lines: [
          { key: 'revenue', label: 'Receitas', values: revenue },
          { key: 'cashReceipts', label: 'Recebimentos avulsos', values: cashFlow.receipts },
          ...countedSections.map((s) => ({ key: s.key, label: s.label, values: tot[s.key] })),
          { key: 'cashExpenses', label: 'Gastos avulsos', values: cashFlow.expenses },
          { key: 'spent', label: 'Gasto final', values: spent },
          { key: 'balance', label: 'Saldo final', values: balance },
        ],
        yearRevenue: sum12(totalRevenue),
        yearSpent: sum12(spent),
        yearBalance: sum12(balance),
      };
      return { sheetId, personId, year, sections, summary, monthly };
    },

    addRow(userId, sheetId, { section, label }) {
      if (!owned('budget_sheets', sheetId, userId)) throw notFound('Planilha não encontrada');
      if (!SECTION_KEYS.includes(section) || section === 'cards') throw badRequest('Seção inválida');
      const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM budget_rows WHERE sheet_id = ?').get(sheetId).p;
      const id = db.prepare('INSERT INTO budget_rows (user_id, sheet_id, section, label, position) VALUES (?,?,?,?,?)').run(userId, sheetId, section, label, pos).lastInsertRowid;
      return { id: Number(id), section, label, position: pos, values: zeros(), receivableFrom: null, obs: null };
    },

    updateRow(userId, rowId, patch) {
      rowOwned(userId, rowId);
      const map = { label: 'label', obs: 'obs', receivableFrom: 'receivable_from' };
      for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) db.prepare(`UPDATE budget_rows SET ${col} = ? WHERE id = ?`).run(patch[k], rowId);
      return { id: rowId, ...patch };
    },

    removeRow(userId, rowId) {
      rowOwned(userId, rowId);
      db.prepare('DELETE FROM budget_rows WHERE id = ?').run(rowId);
    },

    setCell(userId, rowId, month, value) {
      rowOwned(userId, rowId);
      db.prepare('INSERT INTO budget_cells (row_id, user_id, month, value) VALUES (?,?,?,?) ON CONFLICT(row_id, month) DO UPDATE SET value = excluded.value').run(rowId, userId, month, value);
      return { rowId, month, value };
    },

    /** "Arrastar para baixo" da planilha: repete o valor do mês escolhido até dezembro */
    fillRow(userId, rowId, fromMonth, value) {
      rowOwned(userId, rowId);
      const up = db.prepare('INSERT INTO budget_cells (row_id, user_id, month, value) VALUES (?,?,?,?) ON CONFLICT(row_id, month) DO UPDATE SET value = excluded.value');
      db.transaction(() => {
        for (let m = fromMonth; m <= 12; m++) up.run(rowId, userId, m, value);
      })();
      return { rowId, fromMonth, value };
    },
  };
}
