import { badRequest, conflict, notFound } from '../../lib/errors.js';

const cents = (value) => Math.round(Number(value) * 100);
const money = (value) => value / 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value, label) {
  if (value == null || value === '') return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!ISO_DATE.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${label} inválida`);
  }
  return value;
}

function addPeriod(date, frequency, count) {
  if (!date) return null;
  const result = new Date(`${date}T00:00:00Z`);
  if (frequency === 'weekly') result.setUTCDate(result.getUTCDate() + 7 * count);
  else if (frequency === 'biweekly') result.setUTCDate(result.getUTCDate() + 14 * count);
  else {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + count);
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, lastDay));
  }
  return result.toISOString().slice(0, 10);
}

function monthsBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth()
    + (end.getUTCDate() - start.getUTCDate()) / new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
}

function splitCents(total, count) {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function scaleSchedule(schedule, totalCents) {
  if (!schedule.length) return [];
  const weightTotal = schedule.reduce((sum, item) => sum + item.amountCents, 0);
  if (weightTotal === 0) return splitCents(totalCents, schedule.length).map((amountCents, index) => ({ ...schedule[index], amountCents }));
  const result = schedule.map((item) => ({ ...item, amountCents: Math.floor(totalCents * item.amountCents / weightTotal) }));
  let remainder = totalCents - result.reduce((sum, item) => sum + item.amountCents, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % result.length) {
    result[index].amountCents += 1;
    remainder -= 1;
  }
  return result;
}

export function generateCashSchedule({ totalCents, count, firstDueDate, frequency = 'monthly' }) {
  if (!Number.isInteger(totalCents) || totalCents < count || !Number.isInteger(count) || count < 1) {
    throw badRequest('Valor ou quantidade de parcelas inválidos');
  }
  return splitCents(totalCents, count).map((amountCents, index) => ({
    number: index + 1,
    count,
    amountCents,
    dueDate: addPeriod(firstDueDate, frequency, index),
  }));
}

export function createCashLedgerService(db) {
  const owned = (table, id, userId) => db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);

  function assertReferences(userId, data) {
    if (data.personId && !owned('people', data.personId, userId)) throw badRequest('Pessoa inválida');
    if (data.categoryId && !owned('categories', data.categoryId, userId)) throw badRequest('Categoria inválida');
    if (data.vehicleId && !owned('vehicles', data.vehicleId, userId)) throw badRequest('Veículo inválido');
  }

  function normalize(data) {
    const totalCents = cents(data.total);
    if (!Number.isSafeInteger(totalCents) || totalCents < 1) throw badRequest('Informe um valor válido');
    const interestRate = Number(data.interestRate ?? 0);
    if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 100) throw badRequest('Taxa de juros inválida');
    const entryDate = validDate(data.entryDate, 'Data');
    const firstDueDate = validDate(data.firstDueDate, 'Vencimento');
    const expectedReturnDate = validDate(data.expectedReturnDate, 'Data prevista');
    if (!entryDate) throw badRequest('Informe a data');
    return { ...data, totalCents, interestRateBps: Math.round(interestRate * 100), entryDate, firstDueDate, expectedReturnDate };
  }

  function scheduleFor(data) {
    if (data.kind === 'expense') return [];
    if (data.kind === 'refund') {
      return [{ number: 1, count: 1, amountCents: data.totalCents, dueDate: data.expectedReturnDate }];
    }
    const downPaymentCents = data.kind === 'sale' ? cents(data.downPayment || 0) : 0;
    if (downPaymentCents < 0 || downPaymentCents > data.totalCents) throw badRequest('A entrada deve estar entre zero e o valor total');
    const regularInstallmentCount = data.kind === 'sale' && downPaymentCents === data.totalCents ? 0 : data.installmentCount;
    const count = data.kind === 'sale' ? regularInstallmentCount + (downPaymentCents > 0 ? 1 : 0) : data.installmentCount;
    let payableCents = data.totalCents;
    if (data.kind === 'loan' && data.loanTerm !== 'none' && data.interestRateBps > 0 && data.firstDueDate) {
      const lastDueDate = addPeriod(data.firstDueDate, data.frequency, data.installmentCount - 1);
      const durationDays = Math.max(0, (new Date(`${lastDueDate}T00:00:00Z`) - new Date(`${data.entryDate}T00:00:00Z`)) / 86_400_000);
      const durationMonths = data.frequency === 'monthly' && data.loanTerm === 'installments'
        ? data.installmentCount
        : data.frequency === 'monthly'
          ? Math.max(0, monthsBetween(data.entryDate, lastDueDate))
        : durationDays / (365.2425 / 12);
      payableCents += Math.round(data.totalCents * data.interestRateBps * durationMonths / 10_000);
    }
    if (downPaymentCents > 0) {
      return [
        { number: 1, count, amountCents: downPaymentCents, dueDate: data.entryDate },
        ...(regularInstallmentCount > 0 ? generateCashSchedule({
          totalCents: data.totalCents - downPaymentCents,
          count: regularInstallmentCount,
          firstDueDate: data.firstDueDate,
          frequency: data.frequency,
        }).map((item) => ({ ...item, number: item.number + 1, count })) : []),
      ];
    }
    return generateCashSchedule({
      totalCents: payableCents,
      count: data.installmentCount,
      firstDueDate: data.firstDueDate,
      frequency: data.frequency,
    });
  }

  function replacePendingSchedule(userId, entryId, data) {
    const installments = db.prepare(
      `SELECT i.id, i.number, i.count, i.amount_cents AS amountCents, i.due_date AS dueDate,
              COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id), 0) AS receivedCents
       FROM cash_installments i WHERE i.entry_id = ? ORDER BY i.number, i.id`,
    ).all(entryId);
    const completed = installments.filter((item) => item.receivedCents === item.amountCents && item.receivedCents > 0);
    const partial = installments.filter((item) => item.receivedCents > 0 && item.receivedCents < item.amountCents);
    const baseSchedule = scheduleFor(data);
    const scheduledTotal = baseSchedule.reduce((total, item) => total + item.amountCents, 0);
    const completedTotal = completed.reduce((total, item) => total + item.receivedCents, 0);
    const allReceived = installments.reduce((total, item) => total + item.receivedCents, 0);
    if (allReceived > scheduledTotal) throw conflict('O valor não pode ser menor que o total já recebido');
    if (completed.some((item) => !baseSchedule.some((scheduled) => scheduled.number === item.number))) {
      throw conflict('A quantidade de parcelas não pode ser menor que as parcelas já recebidas');
    }
    const completedNumbers = new Set(completed.map((item) => item.number));
    const pendingTemplate = baseSchedule.filter((item) => !completedNumbers.has(item.number));
    const pendingCents = scheduledTotal - completedTotal;
    const pendingSchedule = scaleSchedule(pendingTemplate, pendingCents);
    const keepIds = [...completed, ...partial].map((item) => item.id);
    if (keepIds.length) {
      db.prepare(`DELETE FROM cash_installments WHERE entry_id = ? AND id NOT IN (${keepIds.map(() => '?').join(',')})`)
        .run(entryId, ...keepIds);
    } else {
      db.prepare('DELETE FROM cash_installments WHERE entry_id = ?').run(entryId);
    }
    const insert = db.prepare('INSERT INTO cash_installments (user_id, entry_id, number, count, amount_cents, due_date) VALUES (?,?,?,?,?,?)');
    const update = db.prepare('UPDATE cash_installments SET number = ?, count = ?, amount_cents = ?, due_date = ? WHERE id = ?');
    const count = baseSchedule.length;
    partial.forEach((item, index) => {
      const scheduled = pendingSchedule[index];
      if (!scheduled || scheduled.amountCents < item.receivedCents) {
        throw conflict('O valor não pode ser menor que o total já recebido nesta parcela');
      }
      update.run(scheduled.number, count, scheduled.amountCents, scheduled.dueDate, item.id);
    });
    for (const item of completed) update.run(item.number, count, item.amountCents, item.dueDate, item.id);
    pendingSchedule.slice(partial.length).forEach((item) => insert.run(userId, entryId, item.number, count, item.amountCents, item.dueDate));
  }

  const baseQuery = `
    SELECT e.id, e.kind, e.description, e.total_cents AS totalCents, e.category_id AS categoryId, cat.name AS category,
           e.person_id AS personId, pe.name AS person, e.counterparty, e.entry_date AS entryDate,
           e.payment_method AS paymentMethod, e.down_payment_cents AS downPaymentCents, e.installment_count AS installmentCount, e.first_due_date AS firstDueDate,
           e.frequency, e.loan_term AS loanTerm, e.interest_rate_bps AS interestRateBps, e.protocol,
           e.expected_return_date AS expectedReturnDate, e.refund_status AS refundStatus, e.vehicle_id AS vehicleId,
           v.model AS vehicleName, e.notes, i.id AS installmentId, i.number, i.count, i.amount_cents AS amountCents, i.due_date AS dueDate,
           COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id), 0) AS receivedCents
    FROM cash_entries e
    LEFT JOIN categories cat ON cat.id = e.category_id
    LEFT JOIN people pe ON pe.id = e.person_id
    LEFT JOIN vehicles v ON v.id = e.vehicle_id
    LEFT JOIN cash_installments i ON i.entry_id = e.id`;

  function shape(row, today = new Date().toISOString().slice(0, 10)) {
    const amountCents = row.amountCents ?? (row.kind === 'expense' ? row.totalCents : 0);
    const outstandingCents = Math.max(0, amountCents - row.receivedCents);
    const isRefundDenied = row.kind === 'refund' && row.refundStatus === 'denied';
    const status = row.kind === 'expense' ? 'expense'
      : isRefundDenied ? 'denied'
        : outstandingCents === 0 ? 'received'
          : row.dueDate && row.dueDate < today ? 'overdue'
            : row.receivedCents > 0 ? 'partial' : 'pending';
    return {
      ...row,
      amountCents,
      total: money(row.totalCents),
      amount: money(amountCents),
      received: money(row.receivedCents),
      outstandingCents,
      outstanding: money(outstandingCents),
      interestRate: row.interestRateBps / 100,
      late: status === 'overdue',
      status,
    };
  }

  function entryOwned(userId, entryId) {
    const entry = db.prepare('SELECT * FROM cash_entries WHERE id = ? AND user_id = ?').get(entryId, userId);
    if (!entry) throw notFound('Registro não encontrado');
    return entry;
  }

  const getEntry = (userId, id) => {
    entryOwned(userId, id);
    const rows = db.prepare(`${baseQuery} WHERE e.id = ? AND e.user_id = ? ORDER BY i.number, i.id`).all(id, userId);
    const receipts = db.prepare(
      `SELECT r.id, r.installment_id AS installmentId, r.amount_cents AS amountCents, r.received_on AS receivedOn,
              r.payment_method AS paymentMethod
       FROM cash_receipts r JOIN cash_installments i ON i.id = r.installment_id
       WHERE i.entry_id = ? AND r.user_id = ? ORDER BY r.received_on DESC, r.id DESC`,
    ).all(id, userId).map((receipt) => ({ ...receipt, amount: money(receipt.amountCents) }));
    const installments = rows.filter((row) => row.installmentId).map((row) => shape(row));
    const denied = rows[0].kind === 'refund' && rows[0].refundStatus === 'denied';
    const outstandingCents = installments.reduce((sum, item) => sum + item.outstandingCents, 0);
    const entryStatus = rows[0].kind === 'expense' ? 'expense'
      : denied ? 'denied'
        : installments.length > 0 && installments.every((item) => item.status === 'received') ? 'received'
          : installments.some((item) => item.status === 'partial') ? 'partial'
            : installments.some((item) => item.status === 'overdue') ? 'overdue' : 'pending';
    return {
      entry: rows.length ? {
        ...shape(rows[0]),
        entryStatus,
        totalScheduled: money(installments.reduce((sum, item) => sum + item.amountCents, 0)),
        balance: denied ? 0 : money(outstandingCents),
      } : null,
      installments,
      receipts,
    };
  };

  return {
    generateCashSchedule,

    list(userId, { month, year, all = false, search, personId, kind, status, paymentMethod, categoryId } = {}) {
      const where = ['e.user_id = ?'];
      const params = [userId];
      if (search) {
        where.push('(e.description LIKE ? ESCAPE \'\\\' OR e.counterparty LIKE ? ESCAPE \'\\\' OR pe.name LIKE ? ESCAPE \'\\\')');
        const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        params.push(term, term, term);
      }
      if (personId) (where.push('e.person_id = ?'), params.push(personId));
      if (kind) (where.push('e.kind = ?'), params.push(kind));
      if (paymentMethod) (where.push('e.payment_method = ?'), params.push(paymentMethod));
      if (categoryId) (where.push('e.category_id = ?'), params.push(categoryId));
      if (!all && month && year) {
        where.push(`((e.kind = 'expense' AND substr(e.entry_date, 1, 7) = ?) OR (e.kind <> 'expense' AND ((i.due_date IS NULL AND substr(e.entry_date, 1, 7) = ?) OR substr(i.due_date, 1, 7) = ?)))`);
        const period = `${year}-${String(month).padStart(2, '0')}`;
        params.push(period, period, period);
      }
      const today = new Date().toISOString().slice(0, 10);
      const rows = db.prepare(`${baseQuery} WHERE ${where.join(' AND ')} ORDER BY COALESCE(i.due_date, e.entry_date), e.id, i.number`).all(...params).map((row) => shape(row, today));
      return { data: status ? rows.filter((row) => {
        if (status === 'quitado') return row.status === 'received';
        if (status === 'atrasada') return row.status === 'overdue';
        if (status === 'pendente') return ['pending', 'partial', 'overdue'].includes(row.status);
        return row.status === status;
      }) : rows };
    },

    summary(userId, month, year) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = `${year}-${String(month).padStart(2, '0')}-31`;
      const spentCents = db.prepare("SELECT COALESCE(SUM(total_cents),0) AS amount FROM cash_entries WHERE user_id = ? AND kind = 'expense' AND entry_date >= ? AND entry_date <= ?").get(userId, start, end).amount;
      const dueRows = db.prepare(
        `SELECT i.amount_cents AS amountCents,
                COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id), 0) AS receivedCents,
                i.due_date AS dueDate, e.kind, e.refund_status AS refundStatus
         FROM cash_installments i JOIN cash_entries e ON e.id = i.entry_id
         WHERE i.user_id = ? AND i.due_date >= ? AND i.due_date <= ? AND e.kind <> 'expense'`,
      ).all(userId, start, end);
      const monthReceivable = dueRows.filter((row) => row.refundStatus !== 'denied').reduce((total, row) => total + Math.max(0, row.amountCents - row.receivedCents), 0);
      const overdueRows = db.prepare(
        `SELECT i.amount_cents AS amountCents,
                COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id), 0) AS receivedCents
         FROM cash_installments i JOIN cash_entries e ON e.id = i.entry_id
         WHERE i.user_id = ? AND i.due_date < ? AND e.kind <> 'expense' AND COALESCE(e.refund_status, '') <> 'denied'`,
      ).all(userId, new Date().toISOString().slice(0, 10)).filter((row) => row.amountCents > row.receivedCents);
      const allDue = db.prepare(
        `SELECT i.amount_cents AS amountCents, COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id), 0) AS receivedCents, e.refund_status AS refundStatus
         FROM cash_installments i JOIN cash_entries e ON e.id = i.entry_id
         WHERE i.user_id = ? AND e.kind <> 'expense'`,
      ).all(userId).filter((row) => row.refundStatus !== 'denied');
      const receivedCents = db.prepare(
        `SELECT COALESCE(SUM(r.amount_cents),0) AS amount FROM cash_receipts r
         WHERE r.user_id = ? AND r.received_on >= ? AND r.received_on <= ?`,
      ).get(userId, start, end).amount;
      return {
        spent: money(spentCents),
        receivable: money(monthReceivable),
        received: money(receivedCents),
        totalReceivable: money(allDue.reduce((total, row) => total + Math.max(0, row.amountCents - row.receivedCents), 0)),
        overdue: money(overdueRows.reduce((total, row) => total + row.amountCents - row.receivedCents, 0)),
        overdueCount: overdueRows.length,
      };
    },

    dashboard(userId, { period = 'month', month, year } = {}) {
      const today = new Date().toISOString().slice(0, 10);
      const current = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      const selected = new Date(Date.UTC(year ?? current.getUTCFullYear(), (month ?? current.getUTCMonth() + 1) - 1, 1));
      const formatDate = (date) => date.toISOString().slice(0, 10);
      const shiftMonth = (date, offset) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
      const endOfMonth = (date) => formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
      let start = null;
      let end = null;
      let previousStart = null;
      let previousEnd = null;
      if (period === 'month') {
        start = formatDate(selected);
        end = endOfMonth(selected);
        previousStart = formatDate(shiftMonth(selected, -1));
        previousEnd = endOfMonth(shiftMonth(selected, -1));
      } else if (period === 'last3') {
        start = formatDate(shiftMonth(current, -2));
        end = endOfMonth(current);
        previousStart = formatDate(shiftMonth(current, -5));
        previousEnd = endOfMonth(shiftMonth(current, -3));
      } else if (period === 'year') {
        start = `${selected.getUTCFullYear()}-01-01`;
        end = `${selected.getUTCFullYear()}-12-31`;
        previousStart = `${selected.getUTCFullYear() - 1}-01-01`;
        previousEnd = `${selected.getUTCFullYear() - 1}-12-31`;
      }
      const inRange = (date, from = start, to = end) => Boolean(date && (!from || date >= from) && (!to || date <= to));
      const rows = db.prepare(`${baseQuery} WHERE e.user_id = ? ORDER BY COALESCE(i.due_date, e.entry_date), e.id, i.number`).all(userId)
        .map((row) => shape(row, today));
      const receipts = db.prepare(
        `SELECT r.id, r.amount_cents AS amountCents, r.received_on AS date, r.payment_method AS paymentMethod,
                e.id AS entryId, e.description, e.person_id AS personId, COALESCE(pe.name, e.counterparty) AS person
         FROM cash_receipts r JOIN cash_installments i ON i.id = r.installment_id
         JOIN cash_entries e ON e.id = i.entry_id LEFT JOIN people pe ON pe.id = e.person_id
         WHERE r.user_id = ? ORDER BY r.received_on DESC, r.id DESC`,
      ).all(userId);
      const expenses = rows.filter((row) => row.kind === 'expense');
      const receivables = rows.filter((row) => row.kind !== 'expense' && row.status !== 'denied');
      const periodReceivables = receivables.filter((row) => inRange(row.dueDate) || (period === 'all' && !row.dueDate));
      const outstanding = (row) => row.status === 'denied' ? 0 : row.outstandingCents;
      const sum = (items, getValue) => items.reduce((total, item) => total + getValue(item), 0);
      const expenseInRange = (from = start, to = end) => sum(expenses.filter((row) => inRange(row.entryDate, from, to)), (row) => row.amountCents);
      const receivedInRange = (from = start, to = end) => sum(receipts.filter((row) => inRange(row.date, from, to)), (row) => row.amountCents);
      const spentCents = expenseInRange();
      const receivedCents = receivedInRange();
      const receivableCents = sum(receivables.filter((row) => inRange(row.dueDate)), outstanding);
      const totalReceivableCents = sum(receivables, outstanding);
      const overdueRows = receivables.filter((row) => row.dueDate && row.dueDate < today && outstanding(row) > 0);
      const previousSpentCents = previousStart ? expenseInRange(previousStart, previousEnd) : null;
      const categoryTotals = new Map();
      for (const row of expenses.filter((item) => inRange(item.entryDate))) {
        const key = row.category || 'Sem categoria';
        categoryTotals.set(key, (categoryTotals.get(key) || 0) + row.amountCents);
      }
      const methodNames = { cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', transfer: 'Transferência' };
      const paymentTotals = new Map();
      for (const row of expenses.filter((item) => inRange(item.entryDate))) {
        const key = methodNames[row.paymentMethod] || 'Não informado';
        paymentTotals.set(key, (paymentTotals.get(key) || 0) + row.amountCents);
      }
      const monthBuckets = (count, startDate) => Array.from({ length: count }, (_, index) => {
        const date = shiftMonth(startDate, index);
        const key = formatDate(date).slice(0, 7);
        return { key, label: date.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '') };
      });
      const evolution = monthBuckets(12, shiftMonth(current, -11)).map((bucket) => ({
        ...bucket,
        spentCents: expenseInRange(`${bucket.key}-01`, endOfMonth(new Date(`${bucket.key}-01T00:00:00Z`))),
        receivedCents: receivedInRange(`${bucket.key}-01`, endOfMonth(new Date(`${bucket.key}-01T00:00:00Z`))),
      })).map((item) => ({ ...item, balanceCents: item.receivedCents - item.spentCents }));
      const receivableMonths = monthBuckets(6, current).map((bucket) => ({
        ...bucket,
        amountCents: sum(receivables.filter((row) => row.dueDate?.startsWith(bucket.key)), outstanding),
      }));
      const people = new Map();
      for (const row of periodReceivables) {
        if (outstanding(row) === 0) continue;
        const label = row.person || row.counterparty || 'Sem pessoa vinculada';
        const key = row.personId ?? `name:${label}`;
        const item = people.get(key) || { id: row.personId, name: label, receivedCents: 0, outstandingCents: 0 };
        item.receivedCents += row.receivedCents;
        item.outstandingCents += outstanding(row);
        people.set(key, item);
      }
      const byPerson = [...people.values()].sort((a, b) => b.outstandingCents - a.outstandingCents).slice(0, 10);
      const kindNames = { sale: 'Venda', loan: 'Empréstimo', refund: 'Reembolso' };
      const byKind = Object.entries(kindNames).map(([kind, label]) => ({
        kind, label,
        amountCents: sum(periodReceivables.filter((row) => row.kind === kind), outstanding),
      })).filter((item) => item.amountCents > 0);
      const daysBetween = (from, to) => Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
      const overdue = overdueRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10).map((row) => ({
        entryId: row.id, installmentId: row.installmentId, personId: row.personId,
        description: row.description, person: row.person || row.counterparty || '—', dueDate: row.dueDate,
        amountCents: outstanding(row), daysLate: daysBetween(row.dueDate, today),
      }));
      const upcoming = receivables.filter((row) => row.dueDate && row.dueDate >= today && outstanding(row) > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10).map((row) => ({
          entryId: row.id, installmentId: row.installmentId, personId: row.personId,
          description: row.description, person: row.person || row.counterparty || '—', dueDate: row.dueDate,
          amountCents: outstanding(row),
        }));
      const refundRows = db.prepare(
        `SELECT id, description, counterparty, protocol, entry_date AS entryDate, refund_status AS refundStatus
         FROM cash_entries WHERE user_id = ? AND kind = 'refund' AND refund_status IN ('requested','in_review')
         ORDER BY entry_date, id`,
      ).all(userId).map((row) => ({ ...row, daysPending: daysBetween(row.entryDate, today) }));
      const movements = [
        ...expenses.map((row) => ({
          type: 'expense', entryId: row.id, date: row.entryDate, description: row.description,
          person: row.person || row.counterparty || '—', amountCents: row.amountCents, paymentMethod: row.paymentMethod,
        })),
        ...receipts.map((row) => ({
          type: 'receipt', entryId: row.entryId, date: row.date, description: row.description,
          person: row.person || '—', amountCents: row.amountCents, paymentMethod: row.paymentMethod,
        })),
      ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
      return {
        range: { start, end, previousStart, previousEnd, period },
        totals: {
          spentCents, receivedCents, receivableCents, totalReceivableCents,
          overdueCents: sum(overdueRows, outstanding), overdueCount: overdueRows.length,
          balanceCents: receivedCents - spentCents, previousSpentCents,
          variationPercent: previousSpentCents === null || previousSpentCents === 0
            ? null : ((spentCents - previousSpentCents) / previousSpentCents) * 100,
        },
        evolution, byCategory: [...categoryTotals].map(([label, amountCents]) => ({ label, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
        byPaymentMethod: [...paymentTotals].map(([label, amountCents]) => ({ label, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
        receivableMonths, byPerson, byKind, overdue, upcoming, refunds: refundRows, movements,
      };
    },

    yearSummary(userId, year) {
      const expenses = Array(12).fill(0);
      const receipts = Array(12).fill(0);
      const expenseRows = db.prepare(
        `SELECT CAST(substr(entry_date, 6, 2) AS INTEGER) AS month, SUM(total_cents) AS amount
         FROM cash_entries WHERE user_id = ? AND kind = 'expense' AND substr(entry_date, 1, 4) = ? GROUP BY month`,
      ).all(userId, String(year));
      const receiptRows = db.prepare(
        `SELECT CAST(substr(received_on, 6, 2) AS INTEGER) AS month, SUM(amount_cents) AS amount
         FROM cash_receipts WHERE user_id = ? AND substr(received_on, 1, 4) = ? GROUP BY month`,
      ).all(userId, String(year));
      for (const row of expenseRows) expenses[row.month - 1] = money(row.amount);
      for (const row of receiptRows) receipts[row.month - 1] = money(row.amount);
      return { expenses, receipts };
    },

    personSummary(userId, personId) {
      if (!owned('people', personId, userId)) throw badRequest('Pessoa inválida');
      const rows = db.prepare(`${baseQuery} WHERE e.user_id = ? AND e.person_id = ? AND e.kind <> 'expense' ORDER BY i.due_date, i.number`).all(userId, personId).map((row) => shape(row));
      return {
        person: db.prepare('SELECT id, name FROM people WHERE id = ?').get(personId),
        total: money(rows.reduce((sum, row) => sum + row.amountCents, 0)),
        received: money(rows.reduce((sum, row) => sum + row.receivedCents, 0)),
        outstanding: money(rows.reduce((sum, row) => sum + (row.status === 'denied' ? 0 : row.outstanding * 100), 0)),
        upcoming: rows.filter((row) => row.outstanding > 0 && row.dueDate && row.dueDate >= new Date().toISOString().slice(0, 10)),
        overdue: rows.filter((row) => row.status === 'overdue'),
      };
    },

    get: getEntry,

    create(userId, input) {
      const data = normalize(input);
      assertReferences(userId, data);
      if (data.kind === 'refund' && !['requested', 'in_review', 'received', 'denied'].includes(data.refundStatus)) throw badRequest('Status do reembolso inválido');
      const result = db.transaction(() => {
        const entryId = Number(db.prepare(
          `INSERT INTO cash_entries (user_id, kind, description, total_cents, category_id, person_id, counterparty, entry_date,
           payment_method, down_payment_cents, installment_count, first_due_date, frequency, loan_term, interest_rate_bps, protocol,
           expected_return_date, refund_status, vehicle_id, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(userId, data.kind, data.description, data.totalCents, data.categoryId ?? null, data.personId ?? null, data.counterparty ?? null,
          data.entryDate, data.paymentMethod ?? null, cents(data.downPayment || 0), data.installmentCount ?? 1, data.firstDueDate, data.frequency ?? 'monthly',
          data.loanTerm ?? null, data.interestRateBps, data.protocol ?? null, data.expectedReturnDate,
          data.kind === 'refund' ? (data.refundStatus ?? 'requested') : null, data.vehicleId ?? null, data.notes ?? '').lastInsertRowid);
        const schedule = scheduleFor(data);
        const insert = db.prepare('INSERT INTO cash_installments (user_id, entry_id, number, count, amount_cents, due_date) VALUES (?,?,?,?,?,?)');
        for (const item of schedule) {
          const installmentId = Number(insert.run(userId, entryId, item.number, item.count, item.amountCents, item.dueDate).lastInsertRowid);
          if (data.kind === 'refund' && data.refundStatus === 'received') {
            db.prepare('INSERT INTO cash_receipts (user_id, installment_id, amount_cents, received_on, payment_method) VALUES (?,?,?,?,?)')
              .run(userId, installmentId, item.amountCents, new Date().toISOString().slice(0, 10), data.paymentMethod ?? 'transfer');
          }
        }
        if (data.vehicleId && data.kind === 'sale') {
          const vehicle = db.prepare('SELECT status FROM vehicles WHERE id = ? AND user_id = ?').get(data.vehicleId, userId);
          if (vehicle?.status === 'sold') throw conflict('Este veículo já está marcado como vendido');
          db.prepare("UPDATE vehicles SET status = 'sold', sold_date = ?, sold_value_cents = ? WHERE id = ? AND user_id = ?")
            .run(data.entryDate, data.totalCents, data.vehicleId, userId);
        }
        return entryId;
      })();
      return getEntry(userId, result);
    },

    update(userId, entryId, input) {
      const current = entryOwned(userId, entryId);
      const data = normalize(input);
      assertReferences(userId, data);
      if (current.kind !== data.kind && db.prepare(
        'SELECT 1 FROM cash_receipts r JOIN cash_installments i ON i.id = r.installment_id WHERE i.entry_id = ? LIMIT 1',
      ).get(entryId)) throw conflict('Não é possível trocar o tipo de um registro que já tem recebimentos');
      if (data.kind === 'sale' && data.vehicleId && data.vehicleId !== current.vehicle_id) {
        const vehicle = db.prepare('SELECT status FROM vehicles WHERE id = ? AND user_id = ?').get(data.vehicleId, userId);
        if (vehicle?.status === 'sold') throw conflict('Este veículo já está marcado como vendido');
      }
      db.transaction(() => {
        db.prepare(
          `UPDATE cash_entries SET kind = ?, description = ?, total_cents = ?, category_id = ?, person_id = ?, counterparty = ?,
           entry_date = ?, payment_method = ?, down_payment_cents = ?, installment_count = ?, first_due_date = ?, frequency = ?, loan_term = ?,
           interest_rate_bps = ?, protocol = ?, expected_return_date = ?, refund_status = ?, vehicle_id = ?, notes = ?
           WHERE id = ? AND user_id = ?`,
        ).run(data.kind, data.description, data.totalCents, data.categoryId ?? null, data.personId ?? null, data.counterparty ?? null,
          data.entryDate, data.paymentMethod ?? null, cents(data.downPayment || 0), data.installmentCount ?? 1, data.firstDueDate, data.frequency ?? 'monthly',
          data.loanTerm ?? null, data.interestRateBps, data.protocol ?? null, data.expectedReturnDate,
          data.kind === 'refund' ? (data.refundStatus ?? current.refund_status ?? 'requested') : null, data.vehicleId ?? null, data.notes ?? '', entryId, userId);
        replacePendingSchedule(userId, entryId, data);
        if (current.vehicle_id && (current.vehicle_id !== data.vehicleId || data.kind !== 'sale')) {
          db.prepare("UPDATE vehicles SET status = 'active', sold_date = NULL, sold_value_cents = NULL WHERE id = ? AND user_id = ? AND status = 'sold'").run(current.vehicle_id, userId);
        }
        if (data.vehicleId && data.kind === 'sale') {
          db.prepare("UPDATE vehicles SET status = 'sold', sold_date = ?, sold_value_cents = ? WHERE id = ? AND user_id = ?")
            .run(data.entryDate, data.totalCents, data.vehicleId, userId);
        }
        if (data.kind === 'refund' && data.refundStatus === 'received') {
          const remaining = db.prepare(
            `SELECT COALESCE(SUM(i.amount_cents - COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id), 0)),0) AS amount
             FROM cash_installments i WHERE i.entry_id = ?`,
          ).get(entryId).amount;
          if (remaining > 0) db.prepare("UPDATE cash_entries SET refund_status = 'in_review' WHERE id = ?").run(entryId);
        }
      })();
      return getEntry(userId, entryId);
    },

    remove(userId, entryId, confirmed = false) {
      const entry = entryOwned(userId, entryId);
      const hasReceipts = db.prepare('SELECT 1 FROM cash_receipts r JOIN cash_installments i ON i.id = r.installment_id WHERE i.entry_id = ? LIMIT 1').get(entryId);
      if (hasReceipts && !confirmed) throw conflict('Este registro tem recebimentos; confirme a exclusão antes de tentar novamente');
      if (entry.vehicle_id && entry.kind === 'sale') {
        db.prepare("UPDATE vehicles SET status = 'active', sold_date = NULL, sold_value_cents = NULL WHERE id = ? AND user_id = ? AND status = 'sold'").run(entry.vehicle_id, userId);
      }
      db.prepare('DELETE FROM cash_entries WHERE id = ? AND user_id = ?').run(entryId, userId);
    },

    receive(userId, installmentId, { amount, receivedOn, paymentMethod }) {
      const row = db.prepare(
        `SELECT i.id, i.amount_cents AS amountCents, COALESCE(SUM(r.amount_cents),0) AS receivedCents, e.kind, e.refund_status AS refundStatus
         FROM cash_installments i JOIN cash_entries e ON e.id = i.entry_id
         LEFT JOIN cash_receipts r ON r.installment_id = i.id
         WHERE i.id = ? AND i.user_id = ? GROUP BY i.id`,
      ).get(installmentId, userId);
      if (!row) throw notFound('Parcela não encontrada');
      if (row.kind === 'refund' && row.refundStatus === 'denied') throw conflict('Este reembolso foi recusado');
      const amountCents = cents(amount);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > row.amountCents - row.receivedCents) {
        throw badRequest('O recebimento deve ser maior que zero e não pode superar o saldo da parcela');
      }
      const date = validDate(receivedOn, 'Data do recebimento');
      const result = db.prepare('INSERT INTO cash_receipts (user_id, installment_id, amount_cents, received_on, payment_method) VALUES (?,?,?,?,?)')
        .run(userId, installmentId, amountCents, date, paymentMethod);
      if (row.kind === 'refund') {
        const remaining = row.amountCents - row.receivedCents - amountCents;
        if (remaining === 0) db.prepare("UPDATE cash_entries SET refund_status = 'received' WHERE id = (SELECT entry_id FROM cash_installments WHERE id = ?)").run(installmentId);
      }
      return { id: Number(result.lastInsertRowid), installmentId, amount: money(amountCents), receivedOn: date, paymentMethod };
    },

    receiveMany(userId, installmentIds, paymentMethod, receivedOn) {
      const receive = db.transaction(() => {
        const results = [];
        for (const installmentId of installmentIds) {
          const item = db.prepare(
            `SELECT i.id, i.amount_cents AS amountCents, COALESCE(SUM(r.amount_cents),0) AS receivedCents
             FROM cash_installments i LEFT JOIN cash_receipts r ON r.installment_id = i.id
             WHERE i.id = ? AND i.user_id = ? GROUP BY i.id`,
          ).get(installmentId, userId);
          if (!item) throw notFound('Uma ou mais parcelas não foram encontradas');
          if (item.amountCents <= item.receivedCents) continue;
          results.push(this.receive(userId, installmentId, {
            amount: money(item.amountCents - item.receivedCents), receivedOn, paymentMethod,
          }));
        }
        return results;
      });
      return receive();
    },

    undoReceipt(userId, receiptId) {
      const receipt = db.prepare(
        `SELECT r.id, r.installment_id AS installmentId, i.entry_id AS entryId
         FROM cash_receipts r JOIN cash_installments i ON i.id = r.installment_id
         WHERE r.id = ? AND r.user_id = ?`,
      ).get(receiptId, userId);
      if (!receipt) throw notFound('Recebimento não encontrado');
      db.transaction(() => {
        db.prepare('DELETE FROM cash_receipts WHERE id = ?').run(receiptId);
        db.prepare("UPDATE cash_entries SET refund_status = 'in_review' WHERE id = ? AND kind = 'refund' AND refund_status = 'received'").run(receipt.entryId);
      })();
      return { installmentId: receipt.installmentId };
    },

    setRefundStatus(userId, entryId, status) {
      const entry = entryOwned(userId, entryId);
      if (entry.kind !== 'refund') throw badRequest('O registro não é um reembolso');
      if (status === 'received') {
        const item = db.prepare('SELECT id, amount_cents AS amountCents FROM cash_installments WHERE entry_id = ? AND user_id = ?').get(entryId, userId);
        const receivedCents = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM cash_receipts WHERE installment_id = ?').get(item.id).amount;
        if (receivedCents < item.amountCents) {
          this.receive(userId, item.id, { amount: money(item.amountCents - receivedCents), receivedOn: new Date().toISOString().slice(0, 10), paymentMethod: 'transfer' });
        }
      } else {
        db.prepare('UPDATE cash_entries SET refund_status = ? WHERE id = ? AND user_id = ?').run(status, entryId, userId);
      }
      return getEntry(userId, entryId);
    },

    exportCsv(userId) {
      const rows = db.prepare(
        `SELECT e.kind, e.description, COALESCE(pe.name,e.counterparty,'') AS person, e.entry_date AS entryDate,
                i.due_date AS dueDate, i.number, i.count, COALESCE(i.amount_cents,e.total_cents) AS amountCents,
                COALESCE((SELECT SUM(r.amount_cents) FROM cash_receipts r WHERE r.installment_id = i.id),0) AS receivedCents,
                e.payment_method AS paymentMethod, e.refund_status AS refundStatus
         FROM cash_entries e LEFT JOIN people pe ON pe.id = e.person_id
         LEFT JOIN cash_installments i ON i.entry_id = e.id WHERE e.user_id = ?
         ORDER BY COALESCE(i.due_date,e.entry_date),e.id,i.number`,
      ).all(userId);
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      return [
        ['Tipo', 'Descrição', 'Pessoa', 'Data', 'Vencimento', 'Parcela', 'Valor', 'Recebido', 'Saldo', 'Forma', 'Status'],
        ...rows.map((row) => {
          const outstanding = Math.max(0, row.amountCents - row.receivedCents);
          const status = row.kind === 'expense' ? 'Saída'
            : row.refundStatus === 'denied' ? 'Recusado'
              : outstanding === 0 ? 'Recebida'
                : row.receivedCents > 0 ? 'Parcial'
                  : row.dueDate && row.dueDate < new Date().toISOString().slice(0, 10) ? 'Atrasada' : 'Pendente';
          return [row.kind, row.description, row.person, row.entryDate, row.dueDate, row.number ? `${row.number}/${row.count}` : '', money(row.amountCents), money(row.receivedCents), money(outstanding), row.paymentMethod, status];
        }),
      ].map((line) => line.map(escape).join(';')).join('\r\n');
    },
  };
}
