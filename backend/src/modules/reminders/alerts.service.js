import { SECTIONS } from '../budgets/budgets.defaults.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPENSE_SECTIONS = SECTIONS
  .filter((section) => section.kind === 'expense' && !section.computed)
  .map((section) => section.key);
const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function dateOnly(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from, to) {
  return Math.round((dateOnly(to) - dateOnly(from)) / DAY_MS);
}

function getSystemAlerts(db, userId, today = new Date()) {
  const currentDay = today.getDate();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const alerts = [];

  const cardDebts = db.prepare(
    `SELECT c.id AS cardId, c.name AS cardName, c.due_day AS dueDay,
            i.month, i.year, p.person_id AS personId, pe.name AS personName,
            SUM(MAX(i.amount - COALESCE(i.paid_amount, 0), 0)) AS pendingAmount
     FROM installments i
     JOIN purchases p ON p.id = i.purchase_id
     JOIN cards c ON c.id = p.card_id
     LEFT JOIN people pe ON pe.id = p.person_id
     WHERE p.user_id = ?
       AND i.paid = 0
       AND (i.year < ? OR (i.year = ? AND i.month <= ?))
     GROUP BY c.id, i.month, i.year, p.person_id
     HAVING pendingAmount > 0`,
  ).all(userId, currentYear, currentYear, currentMonth);

  for (const debt of cardDebts) {
    const daysInMonth = new Date(debt.year, debt.month, 0).getDate();
    const dueDay = Math.min(debt.dueDay || 10, daysInMonth);
    const dueDate = new Date(debt.year, debt.month - 1, dueDay);
    const diffDays = daysBetween(today, dueDate);
    let status;
    let severity;

    if (diffDays < 0) {
      status = 'overdue';
      severity = 'danger';
    } else if (diffDays === 0) {
      status = 'today';
      severity = 'danger';
    } else if (diffDays <= 5) {
      status = 'upcoming';
      severity = 'warning';
    } else {
      continue;
    }

    alerts.push({
      id: `card-${debt.cardId}-${debt.personId}-${debt.month}-${debt.year}`,
      type: 'card_invoice',
      title: `Fatura ${debt.cardName} • ${debt.personName || 'Geral'}`,
      description: status === 'overdue'
        ? `Venceu em ${String(dueDay).padStart(2, '0')}/${String(debt.month).padStart(2, '0')} e ainda há saldo pendente.`
        : status === 'today'
          ? `Vence hoje, dia ${dueDay}.`
          : `Vence em ${diffDays} dias, no dia ${String(dueDay).padStart(2, '0')}/${String(debt.month).padStart(2, '0')}.`,
      amount: Math.round(debt.pendingAmount * 100) / 100,
      dueDate: `${debt.year}-${String(debt.month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`,
      status,
      severity,
      personName: debt.personName,
      link: '/cartoes',
    });
  }

  const placeholders = EXPENSE_SECTIONS.map(() => '?').join(', ');
  const detailedSections = EXPENSE_SECTIONS.filter((section) => section !== 'fixed');
  const detailedPlaceholders = detailedSections.map(() => '?').join(', ');
  const budgetDebts = db.prepare(
    `SELECT pe.id AS personId, pe.name AS personName, SUM(bc.value) AS pendingAmount
     FROM people pe
     JOIN budget_sheets bs ON bs.person_id = pe.id AND bs.user_id = pe.user_id
     JOIN budget_rows br ON br.sheet_id = bs.id AND br.user_id = bs.user_id
     JOIN budget_cells bc ON bc.row_id = br.id AND bc.user_id = bs.user_id
     LEFT JOIN month_status ms
       ON ms.user_id = pe.user_id AND ms.person_id = pe.id
       AND ms.year = bs.year AND ms.month = bc.month
     WHERE pe.user_id = ? AND bs.year = ? AND bc.month = ?
       AND br.section IN (${placeholders})
       AND bc.value > 0
       AND NOT (
         br.section = 'fixed'
         AND EXISTS (
           SELECT 1
           FROM budget_rows detailed_row
           JOIN budget_cells detailed_cell
             ON detailed_cell.row_id = detailed_row.id
             AND detailed_cell.user_id = detailed_row.user_id
           WHERE detailed_row.sheet_id = bs.id
             AND detailed_row.user_id = bs.user_id
             AND detailed_row.section IN (${detailedPlaceholders})
             AND detailed_cell.month = bc.month
             AND detailed_cell.value <> 0
         )
       )
       AND COALESCE(ms.status, 'pending') = 'pending'
     GROUP BY pe.id
     HAVING pendingAmount > 0`,
  ).all(
    userId,
    currentYear,
    currentMonth,
    ...EXPENSE_SECTIONS,
    ...detailedSections,
  );

  for (const debt of budgetDebts) {
    alerts.push({
      id: `budget-${debt.personId}-${currentMonth}-${currentYear}`,
      type: 'monthly_budget',
      title: `Despesas do mês • ${debt.personName}`,
      description: `A planilha de ${MONTH_NAMES[currentMonth - 1]}/${currentYear} ainda está marcada como pendente.`,
      amount: Math.round(debt.pendingAmount * 100) / 100,
      dueDate: null,
      status: 'upcoming',
      severity: 'warning',
      personName: debt.personName,
      link: '/planilha',
    });
  }

  const severityOrder = { danger: 1, warning: 2, info: 3 };
  alerts.sort((a, b) => {
    const severityDifference = severityOrder[a.severity] - severityOrder[b.severity];
    return severityDifference || (a.dueDate || '').localeCompare(b.dueDate || '');
  });

  return {
    totalAlerts: alerts.length,
    overdueCount: alerts.filter((alert) => alert.status === 'overdue').length,
    upcomingCount: alerts.filter((alert) => alert.status === 'upcoming' || alert.status === 'today').length,
    alerts,
  };
}

export { getSystemAlerts };
