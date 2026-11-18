import { MONTHS_PT, round2 } from '../../lib/months.js';
import { SECTIONS } from '../budgets/budgets.defaults.js';
import { createCardBilling, getInstallmentBalanceCents, getInvoiceDueDate } from '../../lib/cardBilling.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Installment } from '../../models/Installment.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';

const brl = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const capitalize = (value) => value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1);

export async function getPersonBillingSummary(userId, personId, month, year) {
  const billing = createCardBilling();
  const person = await Person.findOne({ _id: personId, userId }).select('name phone').lean();
  if (!person) return null;
  const purchases = await Purchase.find({ userId, personId }).populate('cardId', 'name dueDay closingDay closingDayEqual').lean();
  const purchaseIds = purchases.map((item) => item._id);
  const installments = purchaseIds.length ? await Installment.find({
    userId, purchaseId: { $in: purchaseIds }, month, year,
  }).sort({ number: 1 }).lean() : [];
  const purchaseById = new Map(purchases.map((item) => [String(item._id), item]));
  const sheet = await BudgetSheet.findOne({ userId, personId, year }).lean();
  const expenses = new Set(SECTIONS.filter((section) => section.kind === 'expense' && !section.computed).map((section) => section.key));
  const budgetRows = (sheet?.rows ?? []).filter((row) => expenses.has(row.section)).flatMap((row) => row.cells.map((cell) => ({
    section: row.section, label: row.label, month: cell.month, amount: cell.value,
  })));
  const detailedBudget = budgetRows.some((row) => row.section !== 'fixed' && row.amount !== 0);
  const fixedExpenses = budgetRows.filter((row) => expenses.has(row.section)
    && !(detailedBudget && row.section === 'fixed') && row.month === month && row.amount > 0)
    .map(({ section, label, amount }) => ({ category: section, label, amount }));
  const monthStatus = await MonthStatus.findOne({ userId, personId, year, month }).select('status').lean();
  const byCard = new Map();
  let totalCardsAmount = 0;
  for (const installment of installments) {
    const purchase = purchaseById.get(String(installment.purchaseId));
    if (!purchase) continue;
    const card = purchase.cardId;
    const key = card ? String(card._id) : 'direct';
    if (!byCard.has(key)) byCard.set(key, {
      cardName: card?.name || 'Sem Cartão / Despesa Direta',
      dueDay: card?.dueDay || null, closingDay: card?.closingDay || null,
      dueDate: card ? getInvoiceDueDate(card, year, month) : null, total: 0, items: [],
    });
    const group = byCard.get(key);
    const paid = installment.paid;
    const balanceDue = getInstallmentBalanceCents(installment.amount, installment.paidAmount, paid) / 100;
    totalCardsAmount += installment.amount;
    group.total += installment.amount;
    group.items.push({
      description: purchase.description, installmentNumber: installment.number,
      totalInstallments: purchase.totalInstallments,
      remaining: Math.max(0, purchase.totalInstallments - installment.number),
      amount: installment.amount, paid, balanceDue,
    });
  }
  totalCardsAmount = round2(totalCardsAmount);
  const totalCardsPending = await billing.calculatePersonInvoice(userId, personId, month, year);
  const totalFixedExpenses = round2(fixedExpenses.reduce((total, expense) => total + expense.amount, 0));
  const grandTotal = round2(totalCardsAmount + totalFixedExpenses);
  const pendingFixedExpenses = monthStatus?.status === 'paid' ? 0 : totalFixedExpenses;
  const grandTotalPending = round2(totalCardsPending + pendingFixedExpenses);
  const cards = [...byCard.values()].map((card) => ({ ...card, total: round2(card.total) }));
  const monthName = capitalize(MONTHS_PT[month - 1]);
  let message = `Olá, *${person.name}*!\nAqui está o demonstrativo das suas despesas para *${monthName}/${year}*:\n\n`;
  if (!installments.length && !fixedExpenses.length) message += 'Você não possui nenhuma pendência ou despesa registrada neste mês! Parabéns!';
  else {
    for (const group of cards) {
      const dueInfo = group.dueDate ? ` _Vencimento ${group.dueDate.split('-').reverse().join('/')}_` : '';
      message += `💳 *${group.cardName}*${dueInfo}\n`;
      for (const item of group.items) {
        const remaining = item.remaining > 0 ? `(restam ${item.remaining})` : '(última!)';
        const count = item.totalInstallments > 1 ? `[${item.installmentNumber}/${item.totalInstallments} ${remaining}]` : '[À vista]';
        message += `  ${item.paid ? '✅' : '⏳'} ${item.description} _${count}_ — *${brl(item.amount)}*\n`;
      }
      message += `  *Subtotal da fatura: ${brl(group.total)}*\n\n`;
    }
    if (fixedExpenses.length) {
      message += '📄 *Contas fixas e despesas do mês*\n';
      for (const expense of fixedExpenses) message += `  • ${expense.label} — *${brl(expense.amount)}*\n`;
      message += `  *Subtotal das contas: ${brl(totalFixedExpenses)}*\n\n`;
    }
    message += `━━━━━━━━━━━━━━━━━━\n📌 *Total do mês: ${brl(grandTotal)}*\n`;
    if (grandTotalPending < grandTotal) message += `⏳ *Saldo pendente: ${brl(grandTotalPending)}*\n`;
  }
  let whatsappLink = null;
  if (person.phone) {
    const cleanPhone = person.phone.replace(/\D/g, '');
    whatsappLink = `https://api.whatsapp.com/send?phone=${cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`}&text=${encodeURIComponent(message)}`;
  }
  return {
    person: { id: String(person._id), name: person.name, phone: person.phone }, month, year,
    totalCardsAmount, totalFixedExpenses, grandTotal, grandTotalPending,
    totalAmount: grandTotal, totalPending: grandTotalPending, cards, fixedExpenses,
    formattedMessage: message, whatsappLink,
  };
}
