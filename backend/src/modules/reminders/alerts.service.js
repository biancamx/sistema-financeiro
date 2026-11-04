import { SECTIONS } from '../budgets/budgets.defaults.js';
import { ensureSubscriptionInstallments, getInvoiceDueDate, getInstallmentBalanceCents } from '../../lib/cardBilling.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Installment } from '../../models/Installment.js';
import { MonthStatus } from '../../models/MonthStatus.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';

const DAY_MS = 86400000;
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dateOnly = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
const daysBetween = (from, to) => Math.round((dateOnly(to) - dateOnly(from)) / DAY_MS);

async function getSystemAlerts(userId, today = new Date()) {
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const alerts = [];
  const purchases = await Purchase.find({ userId })
    .populate('cardId', 'name dueDay closingDay closingDayEqual')
    .populate('personId', 'name')
    .lean();
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  await Promise.all([
    ensureSubscriptionInstallments(userId, previousMonth, previousYear),
    ensureSubscriptionInstallments(userId, currentMonth, currentYear),
  ]);
  const installments = await Installment.find({
    userId,
    $or: [{ year: { $lt: currentYear } }, { year: currentYear, month: { $lte: currentMonth } }],
    paid: false,
  }).lean();
  const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
  const cardInvoices = new Map();
  for (const installment of installments) {
    const purchase = purchaseMap.get(String(installment.purchaseId));
    if (!purchase?.cardId) continue;
    const balance = getInstallmentBalanceCents(installment.amount, installment.paidAmount, installment.paid);
    if (!balance) continue;
    const card = purchase.cardId;
    const key = `${card._id}:${purchase.personId?._id}:${installment.year}:${installment.month}`;
    const invoice = cardInvoices.get(key) ?? { card, person: purchase.personId, year: installment.year, month: installment.month, cents: 0 };
    invoice.cents += balance; cardInvoices.set(key, invoice);
  }
  for (const item of cardInvoices.values()) {
    const dueDateValue = getInvoiceDueDate(item.card, item.year, item.month);
    const [dueYear, dueMonth, dueDay] = dueDateValue.split('-').map(Number);
    const dueDate = new Date(dueYear, dueMonth - 1, dueDay);
    const diffDays = daysBetween(today, dueDate);
    const status = diffDays < 0 ? 'overdue' : diffDays === 0 ? 'today' : diffDays <= 5 ? 'upcoming' : null;
    if (!status) continue;
    const day = String(dueDay).padStart(2, '0'); const month = String(dueMonth).padStart(2, '0');
    alerts.push({
      id: `card-${item.card._id}-${item.person?._id ?? 'all'}-${item.month}-${item.year}`,
      type: 'card_invoice', title: `Fatura ${item.card.name} • ${item.person?.name || 'Geral'}`,
      description: status === 'overdue' ? `Venceu em ${day}/${month} e ainda há saldo pendente.`
        : status === 'today' ? `Vence hoje, dia ${dueDay}.` : `Vence em ${diffDays} dias, no dia ${day}/${month}.`,
      amount: item.cents / 100, dueDate: dueDateValue, status,
      severity: status === 'upcoming' ? 'warning' : 'danger', personName: item.person?.name, link: '/cartoes',
    });
  }
  const people = await Person.find({ userId }).select('name').lean();
  const sheets = await BudgetSheet.find({ userId, year: currentYear, personId: { $in: people.map((person) => person._id) } }).lean();
  const statuses = await MonthStatus.find({ userId, year: currentYear, month: currentMonth }).lean();
  const statusSet = new Set(statuses.filter((item) => item.status === 'paid').map((item) => String(item.personId)));
  const expenseSections = new Set(SECTIONS.filter((section) => section.kind === 'expense' && !section.computed).map((section) => section.key));
  const detailedSections = new Set([...expenseSections].filter((section) => section !== 'fixed'));
  for (const sheet of sheets) {
    if (statusSet.has(String(sheet.personId))) continue;
    const activeRows = sheet.rows.filter((row) => expenseSections.has(row.section) && row.cells.some((cell) => cell.month === currentMonth && cell.value > 0));
    const hasDetail = activeRows.some((row) => detailedSections.has(row.section));
    const sum = activeRows.filter((row) => !(hasDetail && row.section === 'fixed'))
      .reduce((total, row) => total + (row.cells.find((cell) => cell.month === currentMonth)?.value ?? 0), 0);
    if (sum <= 0) continue;
    const person = people.find((item) => String(item._id) === String(sheet.personId));
    alerts.push({
      id: `budget-${sheet.personId}-${currentMonth}-${currentYear}`,
      type: 'monthly_budget', title: `Despesas do mês • ${person?.name ?? ''}`,
      description: `A planilha de ${MONTH_NAMES[currentMonth - 1]}/${currentYear} ainda está marcada como pendente.`,
      amount: Math.round(sum * 100) / 100, dueDate: null, status: 'upcoming', severity: 'warning',
      personName: person?.name, link: '/planilha',
    });
  }
  const severityOrder = { danger: 1, warning: 2, info: 3 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.dueDate || '').localeCompare(b.dueDate || ''));
  return {
    totalAlerts: alerts.length,
    overdueCount: alerts.filter((alert) => alert.status === 'overdue').length,
    upcomingCount: alerts.filter((alert) => ['upcoming', 'today'].includes(alert.status)).length,
    alerts,
  };
}

export { getSystemAlerts };
