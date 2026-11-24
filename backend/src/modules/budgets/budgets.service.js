import { badRequest, notFound } from '../../lib/errors.js';
import { round2 } from '../../lib/months.js';
import { ensureSubscriptionInstallments, getInstallmentBalanceCents } from '../../lib/cardBilling.js';
import { SECTIONS, SECTION_KEYS, createDefaultRows } from './budgets.defaults.js';
import { Person } from '../../models/Person.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { CashEntry } from '../../models/CashEntry.js';
import { Purchase } from '../../models/Purchase.js';
import { Installment } from '../../models/Installment.js';
import { VehicleExpense } from '../../models/VehicleExpense.js';
import { Vehicle } from '../../models/Vehicle.js';
import { createCashLedgerService } from '../cashLedger/cashLedger.service.js';
import { EXPENSE_CATEGORIES } from '../vehicles/vehicles.categories.js';

const zeros = () => Array(12).fill(0);
const sum12 = (arr) => round2(arr.reduce((a, b) => a + b, 0));
const strId = (value) => String(value);

export function createBudgetsService() {
  const cashLedger = createCashLedgerService();
  async function ensureBudgetSheet(userId, personId, year) {
    if (!await Person.exists({ _id: personId, userId })) throw badRequest('Pessoa inválida');
    let sheet = await BudgetSheet.findOne({ userId, personId, year });
    if (!sheet) {
      try {
        sheet = await BudgetSheet.create({ userId, personId, year, rows: createDefaultRows() });
      } catch (error) {
        if (error.code !== 11000) throw error;
        sheet = await BudgetSheet.findOne({ userId, personId, year });
      }
    }
    return sheet;
  }
  async function getRow(userId, rowId) {
    const sheet = await BudgetSheet.findOne({ userId, 'rows._id': rowId });
    if (!sheet) throw notFound('Linha não encontrada');
    const row = sheet.rows.id(rowId);
    if (!row) throw notFound('Linha não encontrada');
    return { sheet, row };
  }
  async function cashYear(userId, year) {
    return cashLedger.yearSummary(userId, year);
  }
  return {
    async ensureSheet(userId, personId, year) {
      return strId((await ensureBudgetSheet(userId, personId, year))._id);
    },
    async years(userId, personId) {
      const sheets = await BudgetSheet.find({ userId, personId }).select('year').sort({ year: 1 }).lean();
      return sheets.map((sheet) => sheet.year);
    },
    async getSheet(userId, personId, year, selectedMonth = new Date().getMonth() + 1) {
      const sheet = await ensureBudgetSheet(userId, personId, year);
      await Promise.all(Array.from({ length: 12 }, (_, index) =>
        ensureSubscriptionInstallments(userId, index + 1, year, { personId }),
      ));
      const rows = sheet.rows.slice().sort((a, b) => a.position - b.position || String(a._id).localeCompare(String(b._id)));
      const byRow = new Map(rows.map((row) => [strId(row._id), {
        id: strId(row._id), section: row.section, label: row.label, position: row.position,
        receivableFrom: row.receivableFrom, obs: row.obs, values: zeros(), paidMonths: Array(12).fill(false), enteredValues: [],
      }]));
      for (const row of rows) for (const cell of row.cells) {
        const item = byRow.get(strId(row._id));
        item.values[cell.month - 1] = cell.value;
        item.paidMonths[cell.month - 1] = Boolean(cell.paid);
        item.enteredValues.push(cell.value);
      }

      const vehicleExpenses = await VehicleExpense.find({
        userId, paymentMethod: 'cash', expenseDate: { $lte: `${year}-12-31` },
      }).populate('vehicleId', 'model').lean();
      const vehicleRows = vehicleExpenses.flatMap((expense) => {
        const share = expense.shares.find((item) => strId(item.personId) === strId(personId));
        if (!share) return [];
        const startYear = Number(expense.expenseDate.slice(0, 4));
        const startMonth = Number(expense.expenseDate.slice(5, 7));
        const recurrenceType = expense.recurrenceType ?? 'once';
        const values = zeros();
        for (let month = 1; month <= 12; month++) {
          const offset = (year - startYear) * 12 + month - startMonth;
          const occurs = offset >= 0 && (
            recurrenceType === 'ongoing'
            || (recurrenceType === 'installments' && offset < (expense.recurrenceCount ?? 0))
            || (recurrenceType === 'once' && offset === 0)
          );
          if (occurs) values[month - 1] = share.amount;
        }
        if (!values.some((value) => value > 0)) return [];
        const categoryLabel = EXPENSE_CATEGORIES.find((item) => item.key === expense.category)?.label ?? expense.category;
        const label = expense.description?.trim() || categoryLabel;
        return [{
          id: `vehicle-expense-${strId(expense._id)}`, section: 'vehicle',
          label: expense.vehicleId?.model ? `${label} · ${expense.vehicleId.model}` : label,
          computed: true, values, paidMonths: Array(12).fill(false), enteredValues: values,
        }];
      });

      const purchases = await Purchase.find({ userId, personId }).populate('cardId', 'name').populate('categoryId', 'name').lean();
      const purchaseIds = purchases.map((purchase) => purchase._id);
      const installments = purchaseIds.length ? await Installment.find({ userId, purchaseId: { $in: purchaseIds }, year }).lean() : [];
      const purchaseById = new Map(purchases.map((purchase) => [strId(purchase._id), purchase]));
      const cardMap = new Map();
      for (const installment of installments) {
        const purchase = purchaseById.get(strId(installment.purchaseId));
        const card = purchase?.cardId;
        if (!card) continue;
        const key = strId(card._id);
        if (!cardMap.has(key)) cardMap.set(key, { id: `card-${key}`, section: 'cards', label: card.name, computed: true, values: zeros() });
        cardMap.get(key).values[installment.month - 1] += installment.amount;
      }
      const sections = SECTIONS.map((section) => {
        const list = section.computed
          ? [...cardMap.values()]
          : [
              ...[...byRow.values()].filter((row) => row.section === section.key),
              ...(section.key === 'vehicle' ? vehicleRows : []),
            ];
        const totals = zeros();
        for (const row of list) row.values.forEach((value, month) => { totals[month] += value; });
        return {
          key: section.key, label: section.label, kind: section.kind, computed: Boolean(section.computed),
          rows: list.map((row) => {
            const { enteredValues, ...item } = row;
            const extremes = section.computed || item.computed || enteredValues.length === 0 ? item.values : enteredValues;
            return { ...item, paidMonths: item.paidMonths ?? Array(12).fill(false), total: sum12(item.values), min: Math.min(...extremes), max: Math.max(...extremes) };
          }),
          totals: totals.map(round2),
        };
      });
      const totals = Object.fromEntries(sections.map((section) => [section.key, section.totals]));
      const cashFlow = await cashYear(userId, year);
      const linkedCashExpenses = await CashEntry.find({
        userId, kind: 'expense', vehicleExpenseId: { $ne: null },
        entryDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
      }).select('entryDate totalCents').lean();
      for (const expense of linkedCashExpenses) {
        const month = Number(expense.entryDate.slice(5, 7)) - 1;
        cashFlow.expenses[month] = round2(cashFlow.expenses[month] - expense.totalCents / 100);
      }
      const revenue = zeros().map((_, month) => round2(totals.income[month] + totals.benefits[month]));
      const totalRevenue = revenue.map((amount, month) => round2(amount + cashFlow.receipts[month]));
      const detailed = SECTIONS.some((section) => !section.computed && section.kind === 'expense'
        && section.key !== 'fixed' && totals[section.key].some((value) => value !== 0));
      const countedSections = SECTIONS.filter((section) => section.kind === 'expense' && !(detailed && section.key === 'fixed'));
      const spent = zeros().map((_, month) => round2(
        countedSections.reduce((sum, section) => sum + totals[section.key][month], 0) + cashFlow.expenses[month],
      ));
      const balance = totalRevenue.map((amount, month) => round2(amount - spent[month]));

      const monthPurchases = installments.filter((item) => item.month === selectedMonth).map((item) => {
        const purchase = purchaseById.get(strId(item.purchaseId));
        const amountCents = Math.round(item.amount * 100);
        const paidCents = amountCents - getInstallmentBalanceCents(item.amount, item.paidAmount, item.paid);
        return {
          installmentId: strId(item._id), purchaseId: strId(purchase._id), description: purchase.description,
          observation: purchase.observation, sharedGroup: purchase.splitGroupId, number: item.number,
          count: purchase.totalInstallments, amount: amountCents / 100, paid: item.paid,
          paidAmount: paidCents / 100, cardId: purchase.cardId ? strId(purchase.cardId._id) : null,
          card: purchase.cardId?.name ?? '', category: purchase.categoryId?.name ?? null,
          outstanding: Math.max(0, amountCents - paidCents) / 100,
        };
      }).sort((a, b) => a.card.localeCompare(b.card, 'pt-BR') || (a.category || '').localeCompare(b.category || '', 'pt-BR') || a.description.localeCompare(b.description, 'pt-BR'));
      const cards = new Map();
      const categories = new Map();
      let totalCents = 0;
      let paidCents = 0;
      let outstandingCents = 0;
      for (const purchase of monthPurchases) {
        const amountCents = Math.round(purchase.amount * 100);
        const currentPaid = Math.round(purchase.paidAmount * 100);
        totalCents += amountCents;
        paidCents += currentPaid;
        outstandingCents += Math.round(purchase.outstanding * 100);
        const card = cards.get(purchase.cardId) ?? { id: purchase.cardId, name: purchase.card, cents: 0 };
        card.cents += amountCents;
        cards.set(purchase.cardId, card);
        const label = purchase.category || 'Sem categoria';
        categories.set(label, (categories.get(label) ?? 0) + amountCents);
      }
      const monthly = {
        month: selectedMonth, total: totalCents / 100, paid: paidCents / 100, outstanding: outstandingCents / 100,
        purchases: monthPurchases,
        cards: [...cards.values()].map(({ cents, ...card }) => ({ ...card, total: cents / 100 })).sort((a, b) => b.total - a.total),
        categories: [...categories].map(([name, cents]) => ({ name, total: cents / 100 })).sort((a, b) => b.total - a.total),
        cash: { expense: cashFlow.expenses[selectedMonth - 1], receipts: cashFlow.receipts[selectedMonth - 1] },
      };
      const summary = {
        lines: [
          { key: 'revenue', label: 'Receitas', values: revenue },
          { key: 'cashReceipts', label: 'Recebimentos avulsos', values: cashFlow.receipts },
          ...countedSections.map((section) => ({ key: section.key, label: section.label, values: totals[section.key] })),
          { key: 'cashExpenses', label: 'Gastos avulsos', values: cashFlow.expenses },
          { key: 'spent', label: 'Gasto final', values: spent },
          { key: 'balance', label: 'Saldo final', values: balance },
        ],
        yearRevenue: sum12(totalRevenue), yearSpent: sum12(spent), yearBalance: sum12(balance),
      };
      return { sheetId: strId(sheet._id), personId: strId(personId), year, sections, summary, monthly };
    },
    async addRow(userId, sheetId, { section, label }) {
      const sheet = await BudgetSheet.findOne({ _id: sheetId, userId });
      if (!sheet) throw notFound('Planilha não encontrada');
      if (!SECTION_KEYS.includes(section) || section === 'cards') throw badRequest('Seção inválida');
      const position = Math.max(0, ...sheet.rows.map((row) => row.position)) + 1;
      sheet.rows.push({ section, label, position, cells: [] });
      await sheet.save();
      const row = sheet.rows[sheet.rows.length - 1];
      return { id: strId(row._id), section, label, position, values: zeros(), receivableFrom: null, obs: null };
    },
    async updateRow(userId, rowId, patch) {
      const { sheet, row } = await getRow(userId, rowId);
      for (const field of ['label', 'obs', 'receivableFrom']) if (patch[field] !== undefined) row[field] = patch[field];
      await sheet.save();
      return { id: strId(row._id), ...patch };
    },
    async moveRow(userId, rowId, section) {
      if (!SECTION_KEYS.includes(section) || section === 'cards') throw badRequest('Seção inválida');
      const { sheet, row } = await getRow(userId, rowId);
      row.section = section;
      await sheet.save();
      return { rowId: strId(row._id), section };
    },
    async removeRow(userId, rowId) {
      const { sheet, row } = await getRow(userId, rowId);
      row.deleteOne();
      await sheet.save();
    },
    async setCell(userId, rowId, month, value) {
      const { sheet, row } = await getRow(userId, rowId);
      const cell = row.cells.find((item) => item.month === month);
      if (cell) {
        if (cell.value !== value) cell.paid = false;
        cell.value = value;
      }
      else row.cells.push({ month, value });
      await sheet.save();
      return { rowId: strId(rowId), month, value };
    },
    async setCellPaid(userId, rowId, month, paid) {
      const { sheet, row } = await getRow(userId, rowId);
      const section = SECTIONS.find((item) => item.key === row.section);
      if (section?.kind !== 'expense' || section.computed) throw badRequest('Só é possível marcar despesas da planilha como pagas.');
      const cell = row.cells.find((item) => item.month === month);
      if (!cell || cell.value <= 0) throw badRequest('Informe um valor para a despesa antes de marcar como paga.');
      cell.paid = paid;
      await sheet.save();
      return { rowId: strId(rowId), month, paid: cell.paid };
    },
    async fillRow(userId, rowId, fromMonth, value) {
      const { sheet, row } = await getRow(userId, rowId);
      for (let month = fromMonth; month <= 12; month++) {
        const cell = row.cells.find((item) => item.month === month);
        if (cell) {
          if (cell.value !== value) cell.paid = false;
          cell.value = value;
        }
        else row.cells.push({ month, value });
      }
      await sheet.save();
      return { rowId: strId(rowId), fromMonth, value };
    },
  };
}
