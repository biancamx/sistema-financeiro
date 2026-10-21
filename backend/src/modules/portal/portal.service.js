import { MONTHS_PT, round2 } from '../../lib/months.js';
import { SECTIONS } from '../budgets/budgets.defaults.js';
import { getInstallmentBalanceCents, getInvoiceDueDate } from '../../lib/cardBilling.js';

const expenseSections = new Set(
  SECTIONS.filter((section) => section.kind === 'expense' && !section.computed).map((section) => section.key),
);

export function getParticipantPortal(db, token) {
  const person = db.prepare(
    `SELECT p.id, p.user_id AS userId, p.name, p.avatar, u.name AS adminName
     FROM people p
     JOIN users u ON u.id = p.user_id
     WHERE p.share_token = ?`,
  ).get(token);
  if (!person) return null;

  const installments = db.prepare(
    `SELECT i.id, i.number AS installmentNumber, i.year, i.month, i.amount, i.paid,
       i.paid_amount AS paidAmount, p.description, p.installments_count AS totalInstallments,
       c.id AS cardId, c.name AS cardName, c.brand AS cardBrand, c.issuer AS bank,
       c.color AS cardColor, c.due_day AS dueDay, c.closing_day AS closingDay
     FROM installments i
     JOIN purchases p ON p.id = i.purchase_id AND p.user_id = i.user_id
     LEFT JOIN cards c ON c.id = p.card_id AND c.user_id = p.user_id
     WHERE i.user_id = ? AND p.person_id = ?
     ORDER BY i.year, i.month, c.name, p.description, i.id`,
  ).all(person.userId, person.id);

  const budgetRows = db.prepare(
    `SELECT s.year, r.id AS rowId, r.section, r.label, r.position, c.month, c.value AS amount,
       COALESCE(ms.status, 'pending') AS monthStatus
     FROM budget_sheets s
     JOIN budget_rows r ON r.sheet_id = s.id AND r.user_id = s.user_id
     LEFT JOIN budget_cells c ON c.row_id = r.id AND c.user_id = s.user_id
     LEFT JOIN month_status ms ON ms.user_id = s.user_id AND ms.person_id = s.person_id
       AND ms.year = s.year AND ms.month = c.month
     WHERE s.user_id = ? AND s.person_id = ?
       AND r.section IN (${[...expenseSections].map(() => '?').join(', ')})
     ORDER BY s.year, r.position, r.id`,
  ).all(person.userId, person.id, ...expenseSections);

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

  return {
    person: { name: person.name, avatar: person.avatar || null },
    admin: { name: person.adminName, phone: null },
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
