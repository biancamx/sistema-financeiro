import { EXPENSE_CATEGORIES } from './vehicles.categories.js';
import { round2 } from '../../lib/months.js';

export function vehicleExpenseBudgetRows(expenses, personId, year) {
  return expenses.flatMap((expense) => {
    const share = expense.shares.find((item) => String(item.personId) === String(personId));
    if (!share) return [];
    const startYear = Number(expense.expenseDate.slice(0, 4));
    const startMonth = Number(expense.expenseDate.slice(5, 7));
    const recurrenceType = expense.recurrenceType ?? 'once';
    const values = Array(12).fill(0);
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
      id: `vehicle-expense-${String(expense._id)}`,
      section: 'vehicle',
      label: expense.vehicleId?.model ? `${label} · ${expense.vehicleId.model}` : label,
      computed: true,
      values,
      total: round2(values.reduce((sum, value) => sum + value, 0)),
      paidMonths: Array(12).fill(false),
      enteredValues: values,
    }];
  });
}
