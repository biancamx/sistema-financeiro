import { MONTHS_PT, round2 } from '../../lib/months.js';
import { SECTIONS } from '../budgets/budgets.defaults.js';

const brl = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const capitalize = (value) => value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1);

export function getPersonBillingSummary(db, userId, personId, month, year) {
  const person = db.prepare('SELECT id, name, phone FROM people WHERE id = ? AND user_id = ?').get(personId, userId);
  if (!person) return null;

  const installments = db.prepare(
    `SELECT i.id AS installmentId, i.number AS installmentNumber, i.amount, i.paid_amount AS paidAmount, i.paid,
            p.id AS purchaseId, p.description, p.installments_count AS totalInstallments,
            p.card_id AS cardId, c.name AS cardName, c.due_day AS dueDay, c.closing_day AS closingDay
     FROM installments i
     JOIN purchases p ON p.id = i.purchase_id
     LEFT JOIN cards c ON c.id = p.card_id
     WHERE p.user_id = ? AND p.person_id = ? AND i.month = ? AND i.year = ?
     ORDER BY c.due_day ASC, p.description ASC`,
  ).all(userId, personId, month, year);

  const budgetRows = db.prepare(
    `SELECT r.id, r.section, r.label, r.position, c.month, c.value AS amount
     FROM budget_sheets s
     JOIN budget_rows r ON r.sheet_id = s.id AND r.user_id = s.user_id
     LEFT JOIN budget_cells c ON c.row_id = r.id AND c.user_id = s.user_id
     WHERE s.user_id = ? AND s.person_id = ? AND s.year = ?
     ORDER BY r.position, r.id`,
  ).all(userId, personId, year);
  const expenseSections = new Set(SECTIONS.filter((section) => section.kind === 'expense' && !section.computed).map((section) => section.key));
  const detailedBudget = budgetRows.some((row) =>
    row.section !== 'fixed' && expenseSections.has(row.section) && row.amount !== null && row.amount !== 0,
  );
  const fixedExpenses = budgetRows
    .filter((row) =>
      expenseSections.has(row.section)
      && !(detailedBudget && row.section === 'fixed')
      && row.month === month
      && row.amount > 0,
    )
    .map((row) => ({ category: row.section, label: row.label, amount: row.amount }));
  const monthStatus = db.prepare(
    'SELECT status FROM month_status WHERE user_id = ? AND person_id = ? AND year = ? AND month = ?',
  ).get(userId, personId, year, month)?.status ?? 'pending';

  const byCard = new Map();
  let totalCardsPending = 0;
  let totalCardsAmount = 0;
  for (const item of installments) {
    const cardKey = item.cardId ?? 'direct';
    if (!byCard.has(cardKey)) {
      byCard.set(cardKey, {
        cardName: item.cardName || 'Sem Cartão / Despesa Direta',
        dueDay: item.dueDay || null,
        closingDay: item.closingDay || null,
        total: 0,
        items: [],
      });
    }

    const group = byCard.get(cardKey);
    const remaining = Math.max(0, item.totalInstallments - item.installmentNumber);
    const paid = Boolean(item.paid);
    const balanceDue = paid ? 0 : round2(Math.max(0, item.amount - item.paidAmount));
    totalCardsAmount += item.amount;
    totalCardsPending += balanceDue;
    group.total += item.amount;
    group.items.push({
      description: item.description,
      installmentNumber: item.installmentNumber,
      totalInstallments: item.totalInstallments,
      remaining,
      amount: item.amount,
      paid,
      balanceDue,
    });
  }

  totalCardsAmount = round2(totalCardsAmount);
  totalCardsPending = round2(totalCardsPending);
  const totalFixedExpenses = round2(fixedExpenses.reduce((total, expense) => total + expense.amount, 0));
  const grandTotal = round2(totalCardsAmount + totalFixedExpenses);
  const pendingFixedExpenses = monthStatus === 'paid' ? 0 : totalFixedExpenses;
  const grandTotalPending = round2(totalCardsPending + pendingFixedExpenses);
  const cards = [...byCard.values()].map((card) => ({ ...card, total: round2(card.total) }));
  const monthName = capitalize(MONTHS_PT[month - 1]);
  let message = `Olá, *${person.name}*!\n`;
  message += `Aqui está o demonstrativo das suas despesas para *${monthName}/${year}*:\n\n`;

  if (!installments.length && !fixedExpenses.length) {
    message += 'Você não possui nenhuma pendência ou despesa registrada neste mês! Parabéns!';
  } else {
    for (const group of cards) {
      const dueInfo = group.dueDay ? `(Vencimento dia ${String(group.dueDay).padStart(2, '0')})` : '';
      message += `💳 *${group.cardName}* ${dueInfo}\n`;
      for (const item of group.items) {
        const statusIcon = item.paid ? '✅' : '⏳';
        const remainingText = item.remaining > 0 ? `(restam ${item.remaining})` : '(última!)';
        const installmentsText = item.totalInstallments > 1
          ? `[${item.installmentNumber}/${item.totalInstallments} ${remainingText}]`
          : '[À vista]';
        message += `  ${statusIcon} ${item.description} ${installmentsText}: *${brl(item.amount)}*\n`;
      }
      message += `  *Subtotal Fatura:* ${brl(group.total)}\n\n`;
    }

    if (fixedExpenses.length) {
      message += '📄 *Contas Fixas & Despesas do Mês:*\n';
      for (const expense of fixedExpenses) {
        message += `  🔹 ${expense.label}: *${brl(expense.amount)}*\n`;
      }
      message += `  *Subtotal Contas:* ${brl(totalFixedExpenses)}\n\n`;
    }

    message += '──────────────────\n';
    message += `📌 *Total Geral do Mês:* ${brl(grandTotal)}\n`;
    if (grandTotalPending < grandTotal) {
      message += `⏳ *Saldo Restante a Pagar:* ${brl(grandTotalPending)}\n`;
    }
  }

  let whatsappLink = null;
  if (person.phone) {
    const cleanPhone = person.phone.replace(/\D/g, '');
    const fullPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    whatsappLink = `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodeURIComponent(message)}`;
  }

  return {
    person,
    month,
    year,
    totalCardsAmount,
    totalFixedExpenses,
    grandTotal,
    grandTotalPending,
    totalAmount: grandTotal,
    totalPending: grandTotalPending,
    cards,
    fixedExpenses,
    formattedMessage: message,
    whatsappLink,
  };
}
