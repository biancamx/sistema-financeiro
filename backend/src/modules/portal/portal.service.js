import { MONTHS_PT, round2 } from '../../lib/months.js';
import { SECTIONS } from '../budgets/budgets.defaults.js';
import { getInstallmentBalanceCents, getInvoiceDueDate } from '../../lib/cardBilling.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Installment } from '../../models/Installment.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { Person } from '../../models/Person.js';
import { User } from '../../models/User.js';

const expenseSections = new Set(
  SECTIONS.filter((section) => section.kind === 'expense' && !section.computed).map((section) => section.key),
);

export async function getParticipantPortal(token) {
  const person = await Person.findOne({ shareToken: token }).lean();
  if (!person) return null;

  const [admin, installmentsWithPurchase, sheets, statuses] = await Promise.all([
    User.findById(person.userId).select('name portalContactPersonId').lean(),
    Installment.find({ userId: person.userId })
      .populate({
        path: 'purchaseId',
        match: { userId: person.userId, personId: person._id },
        select: 'description totalInstallments cardId',
        populate: { path: 'cardId', select: 'name brand issuer color dueDay closingDay' },
      })
      .sort({ year: 1, month: 1, number: 1, _id: 1 })
      .lean(),
    BudgetSheet.find({ userId: person.userId, personId: person._id }).lean(),
    MonthStatus.find({ userId: person.userId, personId: person._id }).lean(),
  ]);
  const contact = admin?.portalContactPersonId
    ? await Person.findOne({ _id: admin.portalContactPersonId, userId: person.userId }).select('phone').lean()
    : null;
  const installments = installmentsWithPurchase.filter((item) => item.purchaseId).map((item) => {
    const purchase = item.purchaseId;
    const card = purchase.cardId;
    return {
      id: String(item._id),
      installmentNumber: item.number,
      year: item.year,
      month: item.month,
      amount: item.amount,
      paid: item.paid,
      paidAmount: item.paidAmount,
      description: purchase.description,
      totalInstallments: purchase.totalInstallments,
      cardId: card ? String(card._id) : null,
      cardName: card?.name ?? null,
      cardBrand: card?.brand ?? null,
      bank: card?.issuer ?? null,
      cardColor: card?.color ?? null,
      dueDay: card?.dueDay ?? null,
      closingDay: card?.closingDay ?? null,
    };
  }).sort((a, b) => a.year - b.year || a.month - b.month
    || (a.cardName || '').localeCompare(b.cardName || '', 'pt-BR')
    || a.description.localeCompare(b.description, 'pt-BR')
    || a.id.localeCompare(b.id));
  const statusByPeriod = new Map(statuses.map((status) => [`${status.year}-${status.month}`, status.status]));
  const budgetRows = sheets.flatMap((sheet) => sheet.rows
    .filter((row) => expenseSections.has(row.section))
    .flatMap((row) => row.cells.length
      ? row.cells.map((cell) => ({
        year: sheet.year,
        rowId: String(row._id),
        section: row.section,
        label: row.label,
        position: row.position,
        month: cell.month,
        amount: cell.value,
        monthStatus: statusByPeriod.get(`${sheet.year}-${cell.month}`) || 'pending',
      }))
      : [{
        year: sheet.year,
        rowId: String(row._id),
        section: row.section,
        label: row.label,
        position: row.position,
        month: null,
        amount: null,
        monthStatus: 'pending',
      }]))
    .sort((a, b) => a.year - b.year || a.position - b.position || a.rowId.localeCompare(b.rowId));

  const detailedMonths = new Set(
    budgetRows
      .filter((row) => row.section !== 'fixed' && row.amount > 0)
      .map((row) => `${row.year}-${row.month}`),
  );
  const months = new Map();
  const getMonth = (year, month) => {
    const key = `${year}-${month}`;
    if (!months.has(key)) {
      months.set(key, {
        key: `${year}-${String(month).padStart(2, '0')}`,
        year,
        month,
        monthName: MONTHS_PT[month - 1],
        total: 0,
        paid: 0,
        pending: 0,
        cards: new Map(),
        fixedExpenses: [],
      });
    }
    return months.get(key);
  };

  let grandTotal = 0;
  let grandPaid = 0;
  let grandPending = 0;
  let grandFuture = 0;
  const now = new Date();
  const currentIndex = now.getFullYear() * 12 + now.getMonth() + 1;

  for (const installment of installments) {
    const month = getMonth(installment.year, installment.month);
    const amount = Number(installment.amount);
    const balanceCents = getInstallmentBalanceCents(amount, installment.paidAmount, installment.paid);
    const pendingAmount = balanceCents / 100;
    const settled = round2(amount - pendingAmount);
    const paid = balanceCents === 0;
    const cardKey = installment.cardId === null ? 'direct' : String(installment.cardId);
    if (!month.cards.has(cardKey)) {
      month.cards.set(cardKey, {
        id: cardKey,
        cardName: installment.cardName || 'Outras Despesas',
        dueDay: installment.dueDay || 10,
        dueDate: installment.cardId
          ? getInvoiceDueDate({ dueDay: installment.dueDay, closingDay: installment.closingDay }, installment.year, installment.month)
          : null,
        color: installment.cardColor || '#059669',
        bank: installment.bank || null,
        brand: installment.cardBrand || null,
        total: 0,
        paid: 0,
        pending: 0,
        items: [],
      });
    }

    const card = month.cards.get(cardKey);
    card.total += amount;
    card.paid += settled;
    card.pending += pendingAmount;
    card.items.push({
      id: `installment-${installment.id}`,
      description: installment.description,
      installmentNumber: installment.installmentNumber,
      totalInstallments: installment.totalInstallments,
      remaining: Math.max(0, installment.totalInstallments - installment.installmentNumber),
      amount,
      paidAmount: round2(settled),
      pendingAmount,
      paid,
      type: 'installment',
    });

    month.total += amount;
    month.paid += settled;
    month.pending += pendingAmount;
    grandTotal += amount;
    grandPaid += settled;
    grandPending += pendingAmount;
    if (installment.year * 12 + installment.month > currentIndex) grandFuture += pendingAmount;
  }

  for (const row of budgetRows) {
    const amount = Number(row.amount) || 0;
    if (!row.month || amount <= 0 || (row.section === 'fixed' && detailedMonths.has(`${row.year}-${row.month}`))) continue;

    const month = getMonth(row.year, row.month);
    const paid = row.monthStatus === 'paid';
    const settled = paid ? amount : 0;
    const pendingAmount = round2(amount - settled);
    month.fixedExpenses.push({
      id: `budget-${row.rowId}-${row.month}`,
      description: row.label,
      amount,
      paidAmount: settled,
      pendingAmount,
      paid,
      type: 'budget',
    });
    month.total += amount;
    month.paid += settled;
    month.pending += pendingAmount;
    grandTotal += amount;
    grandPaid += settled;
    grandPending += pendingAmount;
    if (row.year * 12 + row.month > currentIndex) grandFuture += pendingAmount;
  }

  const sortedMonths = [...months.values()]
    .map((month) => {
      const cards = [...month.cards.values()]
        .map((card) => ({
          ...card,
          total: round2(card.total),
          paid: round2(card.paid),
          pending: round2(card.pending),
          items: card.items.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')),
        }))
        .sort((a, b) => a.cardName.localeCompare(b.cardName, 'pt-BR'));
      const fixedExpenses = month.fixedExpenses.sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
      return {
        ...month,
        monthName: month.monthName.charAt(0).toLocaleUpperCase('pt-BR') + month.monthName.slice(1),
        total: round2(month.total),
        paid: round2(month.paid),
        pending: round2(month.pending),
        itemCount: cards.reduce((count, card) => count + card.items.length, 0) + fixedExpenses.length,
        cards,
        fixedExpenses,
      };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const birthDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(person.birthDate || '');

  return {
    person: {
      name: person.name,
      avatar: person.avatar || null,
      birthday: birthDateMatch ? { month: Number(birthDateMatch[2]), day: Number(birthDateMatch[3]) } : null,
    },
    admin: { name: admin?.name ?? '', phone: contact?.phone || null },
    months: sortedMonths,
    totals: {
      grandTotal: round2(grandTotal),
      grandPaid: round2(grandPaid),
      grandPending: round2(grandPending),
      paid: round2(grandPaid),
      pending: round2(grandPending),
      future: round2(grandFuture),
    },
  };
}
