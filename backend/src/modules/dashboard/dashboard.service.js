import { monthIndex, round2 } from '../../lib/months.js';
import { badRequest } from '../../lib/errors.js';
import { createCardBilling, ensureSubscriptionInstallmentsForPeriods, getInstallmentBalanceCents, getInvoiceDueDate, getInvoiceDuePeriod, subscriptionActiveInPeriod } from '../../lib/cardBilling.js';
import { createBudgetsService } from '../budgets/budgets.service.js';
import { createCashLedgerService } from '../cashLedger/cashLedger.service.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { Installment } from '../../models/Installment.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { CashEntry } from '../../models/CashEntry.js';
import { VehicleExpense } from '../../models/VehicleExpense.js';
import { vehicleExpenseBudgetRows } from '../vehicles/vehicle-expense-budget.js';

export function createDashboardService() {
  const budgets = createBudgetsService();
  const cashLedger = createCashLedgerService();
  const billing = createCardBilling();
  return {
    async summary(userId, { month, year, personId }) {
      const idx = monthIndex(year, month);
      const sum = (rows) => round2(rows.reduce((total, row) => total + row.amount, 0));
      await ensureSubscriptionInstallmentsForPeriods(
        userId,
        [{ month: 12, year: year - 1 }, ...Array.from({ length: 12 }, (_, index) => ({ month: index + 1, year }))],
      );
      const [cardDocs, cash, peopleDocs, purchases, installments] = await Promise.all([
        Card.find({ userId })
          .select('name limit limitGroupId issuer brand lastDigits color ownerId dueDay closingDay closingDayEqual')
          .populate('ownerId', 'name')
          .populate('limitGroupId', 'name institution limit')
          .sort({ name: 1 }).lean(),
        cashLedger.summary(userId, month, year),
        Person.find({ userId }).select('name').sort({ name: 1 }).lean(),
        Purchase.find({ userId }).select('_id personId cardId categoryId isSubscription subscriptionStatus canceledAt subscriptionEndAt').lean(),
        Installment.find({ userId }).select('purchaseId year month amount paidAmount paid').lean(),
      ]);
      const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
      const cardById = new Map(cardDocs.map((card) => [String(card._id), card]));
      const byPersonInstallments = new Map();
      const seriesByMonth = Array(12).fill(0);
      const categoryTotals = new Map();
      const invoiceByCard = new Map();
      const invoiceByPersonCard = new Map();
      const usedByCard = new Map();
      const today = new Date();
      const currentIndex = monthIndex(today.getFullYear(), today.getMonth() + 1);
      for (const installment of installments) {
        const purchase = purchaseMap.get(String(installment.purchaseId));
        if (!purchase) continue;
        const remainingCents = getInstallmentBalanceCents(installment.amount, installment.paidAmount, installment.paid);
        const periodIndex = installment.year * 12 + installment.month;
        const cardKey = String(purchase.cardId);
        const card = cardById.get(cardKey) ?? { closingDay: 3, dueDay: 10 };
        const duePeriod = getInvoiceDuePeriod(card, installment.year, installment.month);
        const subscription = Boolean(purchase.isSubscription);
        if (subscription && !subscriptionActiveInPeriod(purchase, installment.year, installment.month)) continue;
        if (duePeriod.year === year && duePeriod.month === month) {
          invoiceByCard.set(cardKey, (invoiceByCard.get(cardKey) ?? 0) + remainingCents);
          const personCardKey = `${purchase.personId}:${cardKey}`;
          invoiceByPersonCard.set(personCardKey, (invoiceByPersonCard.get(personCardKey) ?? 0) + remainingCents);
        }
        if ((!subscription && periodIndex >= currentIndex)
          || (subscription && periodIndex === currentIndex)) {
          usedByCard.set(cardKey, (usedByCard.get(cardKey) ?? 0) + remainingCents);
        }
        if (duePeriod.year === year) seriesByMonth[duePeriod.month - 1] += installment.amount;
        if (duePeriod.year === year && duePeriod.month === month) {
          const key = purchase.categoryId ? String(purchase.categoryId) : 'none';
          categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + installment.amount);
        }
        const personKey = String(purchase.personId);
        const data = byPersonInstallments.get(personKey) ?? { month: 0, owed: 0, lastIndex: 0 };
        const remaining = remainingCents / 100;
        if (duePeriod.year === year && duePeriod.month === month) {
          data.month += remaining;
          if (subscription) data.owed += remaining;
        }
        const dueIndex = monthIndex(duePeriod.year, duePeriod.month);
        if (!subscription && dueIndex >= idx) data.owed += remaining;
        if (!subscription) data.lastIndex = Math.max(data.lastIndex, dueIndex);
        byPersonInstallments.set(personKey, data);
      }
      const people = peopleDocs.map((person) => {
        const info = byPersonInstallments.get(String(person._id)) ?? { month: 0, owed: 0, lastIndex: 0 };
        return {
          id: String(person._id), name: person.name, month: round2(info.month), owed: round2(info.owed),
          lastPayment: info.lastIndex ? { year: Math.floor((info.lastIndex - 1) / 12), month: ((info.lastIndex - 1) % 12) + 1 } : null,
        };
      });
      const sharedUsedByGroup = new Map();
      for (const card of cardDocs) {
        if (!card.limitGroupId) continue;
        const groupId = String(card.limitGroupId._id);
        const used = usedByCard.get(String(card._id)) ?? 0;
        sharedUsedByGroup.set(groupId, (sharedUsedByGroup.get(groupId) ?? 0) + used);
      }
      const cards = cardDocs.map((card) => {
        const id = String(card._id);
        const invoice = (invoiceByCard.get(id) ?? 0) / 100;
        const limitGroup = card.limitGroupId;
        const limitGroupId = limitGroup?._id ? String(limitGroup._id) : null;
        const limit = limitGroup?.limit ?? card.limit;
        const used = (limitGroupId ? sharedUsedByGroup.get(limitGroupId) : usedByCard.get(id) ?? 0) / 100;
        return {
          id, name: card.name, limit, individualLimit: card.limit, limitGroupId,
          limitGroupName: limitGroup?.name ?? null, limitGroupInstitution: limitGroup?.institution ?? null,
          issuer: card.issuer, brand: card.brand,
          lastFour: card.lastDigits, color: card.color, imageData: null,
          ownerId: card.ownerId ? String(card.ownerId._id) : null, owner: card.ownerId?.name ?? null,
          dueDay: card.dueDay, closingDay: card.closingDay, closingDayEqual: card.closingDayEqual,
          invoice, invoiceDueDate: getInvoiceDueDate(card, year, month), used,
          available: limit > 0 ? round2(limit - used) : 0,
          percentUsed: limit > 0 ? (used / limit) * 100 : 0,
        };
      });
      const cardTotals = cards.map(({ invoice, ...card }) => ({ ...card, amount: invoice }));
      const totalLimits = cards.reduce((totals, card) => {
        const poolId = card.limitGroupId ? `group:${card.limitGroupId}` : `card:${card.id}`;
        if (totals.seen.has(poolId)) return totals;
        totals.seen.add(poolId);
        totals.limit += card.limit;
        totals.available += card.available;
        return totals;
      }, { seen: new Set(), limit: 0, available: 0 });
      const chosen = personId ?? people.find((person) => person.month > 0)?.id ?? people[0]?.id;
      let person = null;
      if (chosen) {
        const invoices = cards.map((card) => ({
          id: card.id, name: card.name,
          amount: (invoiceByPersonCard.get(`${chosen}:${card.id}`) ?? 0) / 100,
          dueDate: card.invoiceDueDate,
        }));
        person = { id: chosen, name: people.find((item) => item.id === String(chosen))?.name, cards: invoices, total: sum(invoices) };
      }
      const categoryIds = [...categoryTotals.keys()].filter((key) => key !== 'none');
      const categories = await Category.find({ userId, _id: { $in: categoryIds } }).select('name').lean();
      const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
      const byCategory = [...categoryTotals].map(([key, amount]) => ({
        name: key === 'none' ? 'Sem categoria' : (categoryNames.get(key) ?? 'Sem categoria'),
        amount: round2(amount),
      })).sort((a, b) => b.amount - a.amount).slice(0, 8);
      return {
        period: { month, year },
        totals: {
          month: sum(cardTotals), owed: round2(people.reduce((total, item) => total + item.owed, 0)),
          limit: round2(totalLimits.limit),
          available: round2(totalLimits.available), cash,
        },
        cardTotals, people, person,
        series: seriesByMonth.map((amount, index) => ({ month: index + 1, amount: round2(amount) })),
        byCategory,
      };
    },
    async personOverview(userId, personId, year) {
      const person = await Person.findOne({ _id: personId, userId }).select('name').lean();
      if (!person) throw badRequest('Pessoa inválida');
      const rows = await billing.calculatePersonInvoicesByYear(userId, personId, year);
      const byCard = new Map();
      for (const row of rows) {
        if (!byCard.has(row.id)) byCard.set(row.id, { id: row.id, name: row.name, values: Array(12).fill(0) });
        byCard.get(row.id).values[row.month - 1] = round2(row.amount);
      }
      const cards = [...byCard.values()].map((card) => ({ ...card, total: round2(card.values.reduce((a, b) => a + b, 0)) }));
      const sheetId = await budgets.ensureSheet(userId, personId, year);
      const sheet = await BudgetSheet.findOne({ _id: sheetId, userId, personId, year }).lean();
      const fixedRows = (sheet?.rows ?? []).filter((row) => row.section === 'fixed')
        .sort((a, b) => a.position - b.position || String(a._id).localeCompare(String(b._id)))
        .map((row) => {
          const values = Array(12).fill(0);
          for (const cell of row.cells) values[cell.month - 1] = cell.value;
          return { id: String(row._id), label: row.label, values, total: round2(values.reduce((a, b) => a + b, 0)) };
        });
      const vehicleExpenses = await VehicleExpense.find({
        userId, paymentMethod: 'cash', expenseDate: { $lte: `${year}-12-31` },
      }).populate('vehicleId', 'model').lean();
      const vehicleRows = vehicleExpenseBudgetRows(vehicleExpenses, personId, year);
      const totals = Array.from({ length: 12 }, (_, month) => round2(
        cards.reduce((sum, card) => sum + card.values[month], 0)
          + fixedRows.reduce((sum, row) => sum + row.values[month], 0)
          + vehicleRows.reduce((sum, row) => sum + row.values[month], 0),
      ));
      const [cashFlow, currentCash, linkedCashExpenses] = await Promise.all([
        cashLedger.yearSummary(userId, year),
        cashLedger.summary(userId, new Date().getMonth() + 1, new Date().getFullYear()),
        CashEntry.find({
          userId, kind: 'expense', vehicleExpenseId: { $ne: null },
          entryDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
        }).select('entryDate totalCents').lean(),
      ]);
      for (const expense of linkedCashExpenses) {
        const month = Number(expense.entryDate.slice(5, 7)) - 1;
        cashFlow.expenses[month] = round2(cashFlow.expenses[month] - expense.totalCents / 100);
      }
      cashFlow.expenses.forEach((amount, month) => { totals[month] = round2(totals[month] + amount); });
      const statusDocs = await MonthStatus.find({ userId, personId, year }).lean();
      const status = Array(12).fill('pending');
      for (const item of statusDocs) status[item.month - 1] = item.status;
      return {
        person: { id: String(person._id), name: person.name }, year, sheetId: sheet ? String(sheet._id) : null,
        cards, fixed: fixedRows, vehicleExpenses: vehicleRows, totals,
        cashFlow: {
          ...cashFlow, monthSpent: currentCash.spent, monthReceipts: currentCash.received,
          totalReceivable: currentCash.totalReceivable, overdue: currentCash.overdue, overdueCount: currentCash.overdueCount,
        },
        yearTotal: round2(totals.reduce((a, b) => a + b, 0)), status,
      };
    },
    async setStatus(userId, { personId, year, month, status }) {
      if (!await Person.exists({ _id: personId, userId })) throw badRequest('Pessoa inválida');
      await MonthStatus.findOneAndUpdate(
        { userId, personId, year, month },
        { $set: { status }, $setOnInsert: { userId, personId, year, month } },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
      return { personId: String(personId), year, month, status };
    },
  };
}
