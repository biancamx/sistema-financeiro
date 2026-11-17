import mongoose from 'mongoose';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { CashEntry } from '../../models/CashEntry.js';
import { CashInstallment } from '../../models/CashInstallment.js';
import { CashReceipt } from '../../models/CashReceipt.js';
import { Category } from '../../models/Category.js';
import { Person } from '../../models/Person.js';
import { Vehicle } from '../../models/Vehicle.js';

const cents = (value) => Math.round(Number(value) * 100);
const money = (value) => value / 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value, label) => {
  if (value == null || value === '') return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!ISO_DATE.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${label} inválida`);
  }
  return value;
};
const addPeriod = (date, frequency, count) => {
  if (!date) return null;
  const result = new Date(`${date}T00:00:00Z`);
  if (frequency === 'weekly') result.setUTCDate(result.getUTCDate() + 7 * count);
  else if (frequency === 'biweekly') result.setUTCDate(result.getUTCDate() + 14 * count);
  else {
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + count);
    result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return result.toISOString().slice(0, 10);
};
const splitCents = (total, count) => {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};
const scaleSchedule = (schedule, total) => {
  if (!schedule.length) return [];
  const weights = schedule.reduce((sum, item) => sum + item.amountCents, 0);
  if (!weights) return splitCents(total, schedule.length).map((amountCents, index) => ({ ...schedule[index], amountCents }));
  const result = schedule.map((item) => ({ ...item, amountCents: Math.floor(total * item.amountCents / weights) }));
  for (let remainder = total - result.reduce((sum, item) => sum + item.amountCents, 0), index = 0; remainder > 0; index = (index + 1) % result.length, remainder--) result[index].amountCents++;
  return result;
};
export function generateCashSchedule({ totalCents, count, firstDueDate, frequency = 'monthly' }) {
  if (!Number.isInteger(totalCents) || totalCents < count || !Number.isInteger(count) || count < 1) throw badRequest('Valor ou quantidade de parcelas inválidos');
  return splitCents(totalCents, count).map((amountCents, index) => ({
    number: index + 1, count, amountCents, dueDate: addPeriod(firstDueDate, frequency, index),
  }));
}

export function createCashLedgerService() {
  const assertReferences = async (userId, data) => {
    if (data.personId && !await Person.exists({ _id: data.personId, userId })) throw badRequest('Pessoa inválida');
    if (data.categoryId && !await Category.exists({ _id: data.categoryId, userId })) throw badRequest('Categoria inválida');
    if (data.vehicleId && !await Vehicle.exists({ _id: data.vehicleId, userId })) throw badRequest('Veículo inválido');
  };
  const normalize = (input) => {
    const totalCents = cents(input.total);
    if (!Number.isSafeInteger(totalCents) || totalCents < 1) throw badRequest('Informe um valor válido');
    const interestRate = Number(input.interestRate ?? 0);
    if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 100) throw badRequest('Taxa de juros inválida');
    const entryDate = validDate(input.entryDate, 'Data');
    const firstDueDate = validDate(input.firstDueDate, 'Vencimento');
    const expectedReturnDate = validDate(input.expectedReturnDate, 'Data prevista');
    if (!entryDate) throw badRequest('Informe a data');
    return { ...input, totalCents, interestRateBps: Math.round(interestRate * 100), entryDate, firstDueDate, expectedReturnDate };
  };
  const scheduleFor = (data) => {
    if (data.kind === 'expense') return [];
    if (data.kind === 'refund') return [{ number: 1, count: 1, amountCents: data.totalCents, dueDate: data.expectedReturnDate }];
    const down = data.kind === 'sale' ? cents(data.downPayment || 0) : 0;
    if (down < 0 || down > data.totalCents) throw badRequest('A entrada deve estar entre zero e o valor total');
    const regularCount = data.kind === 'sale' && down === data.totalCents ? 0 : data.installmentCount;
    const count = data.kind === 'sale' ? regularCount + (down > 0 ? 1 : 0) : data.installmentCount;
    let payable = data.totalCents;
    if (data.kind === 'loan' && data.loanTerm !== 'none' && data.interestRateBps > 0 && data.firstDueDate) {
      const last = addPeriod(data.firstDueDate, data.frequency, data.installmentCount - 1);
      const duration = data.frequency === 'monthly' ? data.installmentCount : Math.max(1, data.installmentCount);
      payable += Math.round(data.totalCents * data.interestRateBps * duration / 10_000);
    }
    if (down > 0) return [
      { number: 1, count, amountCents: down, dueDate: data.entryDate },
      ...(regularCount > 0 ? generateCashSchedule({
        totalCents: data.totalCents - down, count: regularCount, firstDueDate: data.firstDueDate, frequency: data.frequency,
      }).map((item) => ({ ...item, number: item.number + 1, count })) : []),
    ];
    return generateCashSchedule({ totalCents: payable, count: data.installmentCount, firstDueDate: data.firstDueDate, frequency: data.frequency });
  };
  const receiptTotals = async (userId, installmentIds) => {
    if (!installmentIds.length) return new Map();
    const rows = await CashReceipt.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(String(userId)), installmentId: { $in: installmentIds } } },
      { $group: { _id: '$installmentId', amount: { $sum: '$amountCents' } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.amount]));
  };
  const entryOwned = async (userId, entryId, session = null) => {
    const entry = await CashEntry.findOne({ _id: entryId, userId }).session(session).lean();
    if (!entry) throw notFound('Registro não encontrado');
    return entry;
  };
  const loadEntry = async (userId, entryId) => {
    const entry = await CashEntry.findOne({ _id: entryId, userId }).populate('categoryId', 'name').populate('personId', 'name phone').populate('vehicleId', 'model').lean();
    if (!entry) throw notFound('Registro não encontrado');
    const installments = await CashInstallment.find({ userId, entryId }).sort({ number: 1, _id: 1 }).lean();
    const totals = await receiptTotals(userId, installments.map((item) => item._id));
    const receipts = await CashReceipt.find({ userId, installmentId: { $in: installments.map((item) => item._id) } }).sort({ receivedOn: -1, _id: -1 }).lean();
    const today = new Date().toISOString().slice(0, 10);
    const shapedInstallments = installments.map((item) => shape(entry, item, totals.get(String(item._id)) ?? 0, today));
    const shapedReceipts = receipts.map((item) => ({
      id: String(item._id), installmentId: String(item.installmentId), amountCents: item.amountCents,
      amount: money(item.amountCents), receivedOn: item.receivedOn, paymentMethod: item.paymentMethod,
      createdAt: item.createdAt ?? null, updatedAt: item.updatedAt ?? null,
    }));
    const balance = shapedInstallments.reduce((sum, item) => sum + item.outstandingCents, 0);
    const entryStatus = entry.kind === 'expense' ? 'expense'
      : entry.refundStatus === 'denied' ? 'denied'
        : shapedInstallments.length > 0 && shapedInstallments.every((item) => item.status === 'received') ? 'received'
          : shapedInstallments.some((item) => item.status === 'partial') ? 'partial'
            : shapedInstallments.some((item) => item.status === 'overdue') ? 'overdue' : 'pending';
    return {
      entry: {
        ...shape(entry, shapedInstallments[0], shapedInstallments[0]?.receivedCents ?? 0, today),
        id: String(entry._id), categoryId: entry.categoryId ? String(entry.categoryId._id) : null,
        category: entry.categoryId?.name ?? null, personId: entry.personId ? String(entry.personId._id) : null,
        person: entry.personId?.name ?? null, vehicleId: entry.vehicleId ? String(entry.vehicleId._id) : null,
        vehicleName: entry.vehicleId?.model ?? null, entryStatus,
        totalScheduled: money(shapedInstallments.reduce((sum, item) => sum + item.amountCents, 0)),
        balance: entry.refundStatus === 'denied' ? 0 : money(balance),
      },
      installments: shapedInstallments,
      receipts: shapedReceipts,
    };
  };
  function shape(entry, installment, receivedCents, today = new Date().toISOString().slice(0, 10)) {
    const amountCents = installment?.amountCents ?? (entry.kind === 'expense' ? entry.totalCents : 0);
    const outstandingCents = Math.max(0, amountCents - receivedCents);
    const status = entry.kind === 'expense' ? 'expense'
      : entry.kind === 'refund' && entry.refundStatus === 'denied' ? 'denied'
        : outstandingCents === 0 ? 'received'
          : installment?.dueDate && installment.dueDate < today ? 'overdue'
            : receivedCents > 0 ? 'partial' : 'pending';
    return {
      id: installment ? String(installment._id) : String(entry._id),
      entryId: String(entry._id), kind: entry.kind, description: entry.description,
      createdAt: entry.createdAt ?? null, updatedAt: entry.updatedAt ?? null,
      totalCents: entry.totalCents, total: money(entry.totalCents), amountCents, amount: money(amountCents),
      receivedCents, received: money(receivedCents), outstandingCents, outstanding: money(outstandingCents),
      number: installment?.number ?? null, count: installment?.count ?? null, dueDate: installment?.dueDate ?? null,
      entryDate: entry.entryDate, paymentMethod: entry.paymentMethod, counterparty: entry.counterparty,
      downPaymentCents: entry.downPaymentCents, installmentCount: entry.installmentCount,
      firstDueDate: entry.firstDueDate, frequency: entry.frequency, loanTerm: entry.loanTerm,
      interestRateBps: entry.interestRateBps, interestRate: entry.interestRateBps / 100,
      protocol: entry.protocol, expectedReturnDate: entry.expectedReturnDate, refundStatus: entry.refundStatus,
      categoryId: entry.categoryId ? String(entry.categoryId._id ?? entry.categoryId) : null,
      category: entry.categoryId?.name ?? null,
      personId: entry.personId ? String(entry.personId._id ?? entry.personId) : null,
      person: entry.personId?.name ?? null,
      vehicleId: entry.vehicleId ? String(entry.vehicleId._id ?? entry.vehicleId) : null,
      vehicleName: entry.vehicleId?.model ?? null, notes: entry.notes,
      late: status === 'overdue', status,
    };
  }
  async function replaceSchedule(userId, entryId, data, session) {
    const installments = await CashInstallment.find({ userId, entryId }).sort({ number: 1, _id: 1 }).session(session).lean();
    const totals = await receiptTotals(userId, installments.map((item) => item._id));
    const withReceived = installments.map((item) => ({ ...item, receivedCents: totals.get(String(item._id)) ?? 0 }));
    const completed = withReceived.filter((item) => item.receivedCents === item.amountCents && item.receivedCents > 0);
    const partial = withReceived.filter((item) => item.receivedCents > 0 && item.receivedCents < item.amountCents);
    const schedule = scheduleFor(data);
    const total = schedule.reduce((sum, item) => sum + item.amountCents, 0);
    const completedTotal = completed.reduce((sum, item) => sum + item.receivedCents, 0);
    const receivedTotal = withReceived.reduce((sum, item) => sum + item.receivedCents, 0);
    if (receivedTotal > total) throw conflict('O valor não pode ser menor que o total já recebido');
    if (completed.some((item) => !schedule.some((planned) => planned.number === item.number))) throw conflict('A quantidade de parcelas não pode ser menor que as parcelas já recebidas');
    const completedNumbers = new Set(completed.map((item) => item.number));
    const pending = scaleSchedule(schedule.filter((item) => !completedNumbers.has(item.number)), total - completedTotal);
    const keep = [...completed, ...partial];
    await CashInstallment.deleteMany({ userId, entryId, _id: { $nin: keep.map((item) => item._id) } }, { session });
    const count = schedule.length;
    for (const item of completed) await CashInstallment.updateOne({ _id: item._id }, { $set: { count } }, { session });
    for (let i = 0; i < partial.length; i++) {
      const item = partial[i]; const planned = pending[i];
      if (!planned || planned.amountCents < item.receivedCents) throw conflict('O valor não pode ser menor que o total já recebido nesta parcela');
      await CashInstallment.updateOne({ _id: item._id }, { $set: { number: planned.number, count, amountCents: planned.amountCents, dueDate: planned.dueDate } }, { session });
    }
    const remaining = pending.slice(partial.length);
    if (remaining.length) await CashInstallment.insertMany(remaining.map((item) => ({ userId, entryId, ...item })), { session });
  }
  async function recordReceipt(userId, installmentId, data, session = null) {
    const installment = await CashInstallment.findOne({ _id: installmentId, userId }).session(session).lean();
    if (!installment) throw notFound('Parcela não encontrada');
    const entry = await CashEntry.findOne({ _id: installment.entryId, userId }).session(session).lean();
    if (entry.kind === 'refund' && entry.refundStatus === 'denied') throw conflict('Este reembolso foi recusado');
    const totals = await receiptTotals(userId, [installment._id]);
    const received = totals.get(String(installment._id)) ?? 0;
    const amountCents = cents(data.amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > installment.amountCents - received) throw badRequest('O recebimento deve ser maior que zero e não pode superar o saldo da parcela');
    const date = validDate(data.receivedOn, 'Data do recebimento');
    const [receipt] = await CashReceipt.create([{
      userId, installmentId, amountCents, receivedOn: date, paymentMethod: data.paymentMethod,
    }], session ? { session } : {});
    if (entry.kind === 'refund' && installment.amountCents - received - amountCents === 0) {
      await CashEntry.updateOne({ _id: entry._id, userId }, { $set: { refundStatus: 'received' } }, session ? { session } : {});
    }
    return { id: String(receipt._id), installmentId: String(installmentId), amount: money(amountCents), receivedOn: date, paymentMethod: data.paymentMethod };
  }
  return {
    generateCashSchedule,
    async list(userId, query = {}) {
      const entries = await CashEntry.find({ userId }).populate('categoryId', 'name').populate('personId', 'name').populate('vehicleId', 'model').sort({ entryDate: 1 }).lean();
      const installments = await CashInstallment.find({ userId }).sort({ dueDate: 1, number: 1 }).lean();
      const receiptsMap = await receiptTotals(userId, installments.map((item) => item._id));
      const byEntry = new Map();
      for (const item of installments) {
        const entry = entries.find((row) => String(row._id) === String(item.entryId));
        if (!entry) continue;
        const shaped = shape(entry, item, receiptsMap.get(String(item._id)) ?? 0);
        const list = byEntry.get(String(item.entryId)) ?? [];
        list.push(shaped); byEntry.set(String(item.entryId), list);
      }
      const today = new Date().toISOString().slice(0, 10);
      let data = entries.flatMap((entry) => {
        const list = byEntry.get(String(entry._id));
        const base = { ...entry, id: String(entry._id), categoryId: entry.categoryId ? String(entry.categoryId._id) : null, category: entry.categoryId?.name ?? null, personId: entry.personId ? String(entry.personId._id) : null, person: entry.personId?.name ?? null, vehicleId: entry.vehicleId ? String(entry.vehicleId._id) : null, vehicleName: entry.vehicleId?.model ?? null };
        return entry.kind === 'expense' ? [shape(entry, null, 0, today)] : (list?.length ? list : [shape(entry, null, 0, today)]);
      });
      const filters = query;
      if (filters.search) {
        const re = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        data = data.filter((row) => re.test(row.description || '') || re.test(row.counterparty || '') || re.test(row.person || ''));
      }
      for (const key of ['personId', 'kind', 'paymentMethod', 'categoryId']) if (filters[key]) data = data.filter((row) => String(row[key]) === String(filters[key]));
      if (!filters.all && filters.month && filters.year) {
        const period = `${filters.year}-${String(filters.month).padStart(2, '0')}`;
        data = data.filter((row) => row.kind === 'expense' ? row.entryDate.startsWith(period) : (row.dueDate || row.entryDate).startsWith(period));
      }
      data.sort((a, b) => (a.dueDate || a.entryDate || '').localeCompare(b.dueDate || b.entryDate || '') || String(a.id).localeCompare(String(b.id)));
      if (filters.status) data = data.filter((row) => filters.status === 'quitado' ? row.status === 'received'
        : filters.status === 'atrasada' ? row.status === 'overdue'
          : filters.status === 'pendente' ? ['pending', 'partial', 'overdue'].includes(row.status) : row.status === filters.status);
      return { data };
    },
    async summary(userId, month, year) {
      const from = `${year}-${String(month).padStart(2, '0')}-01`; const to = `${year}-${String(month).padStart(2, '0')}-31`;
      const [all, installments] = await Promise.all([
        CashEntry.find({ userId }).lean(), CashInstallment.find({ userId }).lean(),
      ]);
      const receipts = await CashReceipt.find({ userId }).lean();
      const totals = await receiptTotals(userId, installments.map((item) => item._id));
      const spent = all.filter((item) => item.kind === 'expense' && item.entryDate >= from && item.entryDate <= to).reduce((sum, item) => sum + item.totalCents, 0);
      const monthDue = installments.filter((i) => i.dueDate >= from && i.dueDate <= to && all.some((e) => String(e._id) === String(i.entryId) && e.kind !== 'expense' && e.refundStatus !== 'denied'))
        .reduce((sum, i) => sum + Math.max(0, i.amountCents - (totals.get(String(i._id)) ?? 0)), 0);
      const overdue = installments.filter((i) => i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10) && i.amountCents > (totals.get(String(i._id)) ?? 0))
        .filter((i) => all.some((e) => String(e._id) === String(i.entryId) && e.kind !== 'expense' && e.refundStatus !== 'denied'));
      const totalDue = installments.filter((i) => all.some((e) => String(e._id) === String(i.entryId) && e.kind !== 'expense' && e.refundStatus !== 'denied'))
        .reduce((sum, i) => sum + Math.max(0, i.amountCents - (totals.get(String(i._id)) ?? 0)), 0);
      const received = receipts.filter((r) => r.receivedOn >= from && r.receivedOn <= to).reduce((sum, r) => sum + r.amountCents, 0);
      return { spent: money(spent), receivable: money(monthDue), received: money(received), totalReceivable: money(totalDue), overdue: money(overdue.reduce((sum, i) => sum + i.amountCents - (totals.get(String(i._id)) ?? 0), 0)), overdueCount: overdue.length };
    },
    async dashboard(userId, { period = 'month', month, year } = {}) {
      const [entries, installments, receipts] = await Promise.all([
        CashEntry.find({ userId }).populate('categoryId', 'name').populate('personId', 'name').lean(),
        CashInstallment.find({ userId }).lean(), CashReceipt.find({ userId }).lean(),
      ]);
      const totals = await receiptTotals(userId, installments.map((item) => item._id));
      const today = new Date().toISOString().slice(0, 10);
      const current = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      const selected = new Date(Date.UTC(year ?? current.getUTCFullYear(), (month ?? current.getUTCMonth() + 1) - 1, 1));
      const shift = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
      const fmt = (d) => d.toISOString().slice(0, 10);
      const endMonth = (d) => fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
      let start = null; let end = null; let previousStart = null; let previousEnd = null;
      if (period === 'month') { start = fmt(selected); end = endMonth(selected); previousStart = fmt(shift(selected, -1)); previousEnd = endMonth(shift(selected, -1)); }
      if (period === 'last3') { start = fmt(shift(current, -2)); end = endMonth(current); previousStart = fmt(shift(current, -5)); previousEnd = endMonth(shift(current, -3)); }
      if (period === 'year') { start = `${selected.getUTCFullYear()}-01-01`; end = `${selected.getUTCFullYear()}-12-31`; previousStart = `${selected.getUTCFullYear() - 1}-01-01`; previousEnd = `${selected.getUTCFullYear() - 1}-12-31`; }
      const inRange = (date, from = start, to = end) => Boolean(date && (!from || date >= from) && (!to || date <= to));
      const entryMap = new Map(entries.map((item) => [String(item._id), item]));
      const shaped = installments.map((item) => {
        const entry = entryMap.get(String(item.entryId));
        return { ...shape(entry, item, totals.get(String(item._id)) ?? 0, today), raw: entry };
      });
      const expenses = entries.filter((row) => row.kind === 'expense');
      const receivables = shaped.filter((row) => row.kind !== 'expense' && row.status !== 'denied');
      const relevant = (row) => inRange(row.dueDate) || (period === 'all' && !row.dueDate);
      const rangeSpent = (from, to) => expenses.filter((row) => inRange(row.entryDate, from, to)).reduce((sum, row) => sum + row.totalCents, 0);
      const rangeReceived = (from, to) => receipts.filter((row) => inRange(row.receivedOn, from, to)).reduce((sum, row) => sum + row.amountCents, 0);
      const spent = rangeSpent(); const received = rangeReceived();
      const outstanding = (row) => row.status === 'denied' ? 0 : row.outstandingCents;
      const priorSpent = previousStart ? rangeSpent(previousStart, previousEnd) : null;
      const categoryTotals = new Map(); const paymentTotals = new Map();
      const paymentLabels = { cash: 'Dinheiro', pix: 'Pix', debit: 'Débito', transfer: 'Transferência' };
      for (const row of expenses.filter((item) => inRange(item.entryDate))) {
        const category = row.categoryId?.name || 'Sem categoria';
        categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + row.totalCents);
        const method = paymentLabels[row.paymentMethod] || 'Não informado';
        paymentTotals.set(method, (paymentTotals.get(method) ?? 0) + row.totalCents);
      }
      const monthBuckets = (count, first) => Array.from({ length: count }, (_, index) => {
        const date = shift(first, index); const key = fmt(date).slice(0, 7);
        return { key, label: date.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '') };
      });
      const evolution = monthBuckets(12, shift(current, -11)).map((bucket) => {
        const from = `${bucket.key}-01`; const to = endMonth(new Date(`${from}T00:00:00Z`));
        const spentCents = rangeSpent(from, to); const receivedCents = rangeReceived(from, to);
        return { ...bucket, spentCents, receivedCents, balanceCents: receivedCents - spentCents };
      });
      const receivableMonths = monthBuckets(6, current).map((bucket) => ({
        ...bucket, amountCents: receivables.filter((row) => row.dueDate?.startsWith(bucket.key)).reduce((sum, row) => sum + outstanding(row), 0),
      }));
      const byPersonMap = new Map();
      for (const row of receivables.filter(relevant)) {
        if (!outstanding(row)) continue;
        const personName = row.raw.personId?.name || row.counterparty || 'Sem pessoa vinculada';
        const key = row.raw.personId?._id ? String(row.raw.personId._id) : `name:${personName}`;
        const item = byPersonMap.get(key) ?? { id: row.raw.personId?._id ? String(row.raw.personId._id) : undefined, name: personName, receivedCents: 0, outstandingCents: 0 };
        item.receivedCents += row.receivedCents; item.outstandingCents += outstanding(row); byPersonMap.set(key, item);
      }
      const byPerson = [...byPersonMap.values()].sort((a, b) => b.outstandingCents - a.outstandingCents).slice(0, 10);
      const kindLabels = { sale: 'Venda', loan: 'Empréstimo', refund: 'Reembolso' };
      const byKind = Object.entries(kindLabels).map(([kind, label]) => ({
        kind, label, amountCents: receivables.filter((row) => relevant(row) && row.kind === kind).reduce((sum, row) => sum + outstanding(row), 0),
      })).filter((item) => item.amountCents > 0);
      const lateRows = receivables.filter((row) => row.dueDate && row.dueDate < today && outstanding(row) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const daysBetween = (from, to) => Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));
      const overdue = lateRows.slice(0, 10).map((row) => ({ entryId: row.entryId, installmentId: row.id, personId: row.raw.personId ? String(row.raw.personId._id) : null, description: row.description, person: row.raw.personId?.name || row.counterparty || '—', dueDate: row.dueDate, amountCents: outstanding(row), daysLate: daysBetween(row.dueDate, today) }));
      const upcoming = receivables.filter((row) => row.dueDate && row.dueDate >= today && outstanding(row) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10)
        .map((row) => ({ entryId: row.entryId, installmentId: row.id, personId: row.raw.personId ? String(row.raw.personId._id) : null, description: row.description, person: row.raw.personId?.name || row.counterparty || '—', dueDate: row.dueDate, amountCents: outstanding(row) }));
      const refunds = entries.filter((row) => row.kind === 'refund' && ['requested', 'in_review'].includes(row.refundStatus))
        .map((row) => ({ id: String(row._id), description: row.description, counterparty: row.counterparty, protocol: row.protocol, entryDate: row.entryDate, refundStatus: row.refundStatus, daysPending: daysBetween(row.entryDate, today) }));
      const movements = [
        ...expenses.map((row) => ({ type: 'expense', entryId: String(row._id), date: row.entryDate, description: row.description, person: row.personId?.name || row.counterparty || '—', amountCents: row.totalCents, paymentMethod: row.paymentMethod })),
        ...receipts.map((row) => { const item = entryMap.get(String(installments.find((inst) => String(inst._id) === String(row.installmentId))?.entryId)); return { type: 'receipt', entryId: item ? String(item._id) : null, date: row.receivedOn, description: item?.description || '', person: item?.personId?.name || '—', amountCents: row.amountCents, paymentMethod: row.paymentMethod }; }),
      ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
      const receivableCents = receivables.filter((row) => inRange(row.dueDate)).reduce((sum, row) => sum + outstanding(row), 0);
      const totalReceivableCents = receivables.reduce((sum, row) => sum + outstanding(row), 0);
      return {
        range: { start, end, previousStart, previousEnd, period },
        totals: {
          spentCents: spent, receivedCents: received, receivableCents, totalReceivableCents,
          overdueCents: lateRows.reduce((sum, row) => sum + outstanding(row), 0), overdueCount: lateRows.length,
          balanceCents: received - spent, previousSpentCents: priorSpent,
          variationPercent: priorSpent === null || priorSpent === 0 ? null : ((spent - priorSpent) / priorSpent) * 100,
        },
        evolution,
        byCategory: [...categoryTotals].map(([label, amountCents]) => ({ label, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
        byPaymentMethod: [...paymentTotals].map(([label, amountCents]) => ({ label, amountCents })).sort((a, b) => b.amountCents - a.amountCents),
        receivableMonths, byPerson, byKind, overdue, upcoming, refunds, movements,
      };
    },
    async yearSummary(userId, year) {
      const from = `${year}-01-01`; const to = `${year}-12-31`;
      const [expenseRows, receipts] = await Promise.all([
        CashEntry.find({ userId, kind: 'expense', entryDate: { $gte: from, $lte: to } }).select('entryDate totalCents').lean(),
        CashReceipt.find({ userId, receivedOn: { $gte: from, $lte: to } }).select('receivedOn amountCents').lean(),
      ]);
      const expenses = Array(12).fill(0); const received = Array(12).fill(0);
      for (const row of expenseRows) expenses[Number(row.entryDate.slice(5, 7)) - 1] += row.totalCents / 100;
      for (const row of receipts) received[Number(row.receivedOn.slice(5, 7)) - 1] += row.amountCents / 100;
      return { expenses, receipts: received };
    },
    async personSummary(userId, personId) {
      const person = await Person.findOne({ _id: personId, userId }).select('name').lean();
      if (!person) throw badRequest('Pessoa inválida');
      const entryIds = (await CashEntry.find({ userId, personId, kind: { $ne: 'expense' } }).select('_id').lean()).map((item) => item._id);
      const installments = await CashInstallment.find({ userId, entryId: { $in: entryIds } }).lean();
      const totals = await receiptTotals(userId, installments.map((item) => item._id));
      const today = new Date().toISOString().slice(0, 10);
      const rows = await Promise.all(installments.map(async (item) => {
        const entry = await CashEntry.findOne({ _id: item.entryId, userId }).lean();
        return shape(entry, item, totals.get(String(item._id)) ?? 0, today);
      }));
      return {
        person: { id: String(person._id), name: person.name },
        total: money(rows.reduce((sum, row) => sum + row.amountCents, 0)),
        received: money(rows.reduce((sum, row) => sum + row.receivedCents, 0)),
        outstanding: money(rows.reduce((sum, row) => sum + (row.status === 'denied' ? 0 : row.outstandingCents), 0)),
        upcoming: rows.filter((row) => row.outstanding > 0 && row.dueDate && row.dueDate >= today),
        overdue: rows.filter((row) => row.status === 'overdue'),
      };
    },
    get: loadEntry,
    async create(userId, input) {
      const data = normalize(input); await assertReferences(userId, data);
      if (data.kind === 'refund' && !['requested', 'in_review', 'received', 'denied'].includes(data.refundStatus)) throw badRequest('Status do reembolso inválido');
      const session = await mongoose.startSession(); let entryId;
      try {
        await session.withTransaction(async () => {
          const [entry] = await CashEntry.create([{
            userId, kind: data.kind, description: data.description, totalCents: data.totalCents,
            categoryId: data.categoryId ?? null, personId: data.personId ?? null, counterparty: data.counterparty ?? null,
            entryDate: data.entryDate, paymentMethod: data.paymentMethod ?? null,
            downPaymentCents: cents(data.downPayment || 0), installmentCount: data.installmentCount ?? 1,
            firstDueDate: data.firstDueDate, frequency: data.frequency ?? 'monthly', loanTerm: data.loanTerm ?? null,
            interestRateBps: data.interestRateBps, protocol: data.protocol ?? null, expectedReturnDate: data.expectedReturnDate,
            refundStatus: data.kind === 'refund' ? (data.refundStatus ?? 'requested') : null,
            vehicleId: data.vehicleId ?? null, notes: data.notes ?? '',
          }], { session });
          entryId = entry._id;
          const schedule = scheduleFor(data);
          if (schedule.length) {
            const created = await CashInstallment.insertMany(schedule.map((item) => ({ userId, entryId, ...item })), { session });
            if (data.kind === 'refund' && data.refundStatus === 'received') {
              await CashReceipt.insertMany(created.map((item) => ({
                userId, installmentId: item._id, amountCents: item.amountCents,
                receivedOn: new Date().toISOString().slice(0, 10), paymentMethod: data.paymentMethod ?? 'transfer',
              })), { session });
            }
          }
          if (data.vehicleId && data.kind === 'sale') {
            const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).session(session);
            if (vehicle?.status === 'sold') throw conflict('Este veículo já está marcado como vendido');
            if (vehicle) {
              vehicle.status = 'sold'; vehicle.soldDate = data.entryDate; vehicle.soldValueCents = data.totalCents;
              await vehicle.save({ session });
            }
          }
        });
      } finally { await session.endSession(); }
      return loadEntry(userId, entryId);
    },
    async update(userId, entryId, input) {
      const current = await entryOwned(userId, entryId); const data = normalize(input); await assertReferences(userId, data);
      if (current.kind !== data.kind && await CashInstallment.exists({ userId, entryId }).then(async (exists) => exists && await CashReceipt.exists({ userId, installmentId: { $in: (await CashInstallment.find({ userId, entryId }).distinct('_id')) } }))) {
        throw conflict('Não é possível trocar o tipo de um registro que já tem recebimentos');
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await CashEntry.updateOne({ _id: entryId, userId }, { $set: {
            kind: data.kind, description: data.description, totalCents: data.totalCents,
            categoryId: data.categoryId ?? null, personId: data.personId ?? null, counterparty: data.counterparty ?? null,
            entryDate: data.entryDate, paymentMethod: data.paymentMethod ?? null,
            downPaymentCents: cents(data.downPayment || 0), installmentCount: data.installmentCount ?? 1,
            firstDueDate: data.firstDueDate, frequency: data.frequency ?? 'monthly', loanTerm: data.loanTerm ?? null,
            interestRateBps: data.interestRateBps, protocol: data.protocol ?? null, expectedReturnDate: data.expectedReturnDate,
            refundStatus: data.kind === 'refund' ? (data.refundStatus ?? current.refundStatus ?? 'requested') : null,
            vehicleId: data.vehicleId ?? null, notes: data.notes ?? '',
          } }, { session });
          await replaceSchedule(userId, entryId, data, session);
          if (current.vehicleId && (String(current.vehicleId) !== String(data.vehicleId) || data.kind !== 'sale')) {
            await Vehicle.updateOne({ _id: current.vehicleId, userId, status: 'sold' }, { $set: { status: 'active', soldDate: null, soldValueCents: null } }, { session });
          }
          if (data.vehicleId && data.kind === 'sale') {
            await Vehicle.updateOne({ _id: data.vehicleId, userId }, { $set: { status: 'sold', soldDate: data.entryDate, soldValueCents: data.totalCents } }, { session });
          }
          if (data.kind === 'refund' && data.refundStatus === 'received') {
            const ids = await CashInstallment.find({ userId, entryId }).distinct('_id').session(session);
            const received = await CashReceipt.aggregate([
              { $match: { userId: new mongoose.Types.ObjectId(String(userId)), installmentId: { $in: ids } } },
              { $group: { _id: null, sum: { $sum: '$amountCents' } } },
            ]).session(session);
            const scheduled = await CashInstallment.aggregate([{ $match: { userId, entryId } }, { $group: { _id: null, sum: { $sum: '$amountCents' } } }]).session(session);
            if ((scheduled[0]?.sum ?? 0) > (received[0]?.sum ?? 0)) {
              await CashEntry.updateOne({ _id: entryId }, { $set: { refundStatus: 'in_review' } }, { session });
            }
          }
        });
      } finally { await session.endSession(); }
      return loadEntry(userId, entryId);
    },
    async remove(userId, entryId, confirmed = false) {
      const entry = await entryOwned(userId, entryId);
      const installments = await CashInstallment.find({ userId, entryId }).select('_id').lean();
      const hasReceipts = await CashReceipt.exists({ userId, installmentId: { $in: installments.map((item) => item._id) } });
      if (hasReceipts && !confirmed) throw conflict('Este registro tem recebimentos; confirme a exclusão antes de tentar novamente');
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          if (entry.vehicleId && entry.kind === 'sale') await Vehicle.updateOne(
            { _id: entry.vehicleId, userId, status: 'sold' }, { $set: { status: 'active', soldDate: null, soldValueCents: null } }, { session },
          );
          await CashReceipt.deleteMany({ userId, installmentId: { $in: installments.map((item) => item._id) } }, { session });
          await CashInstallment.deleteMany({ userId, entryId }, { session });
          await CashEntry.deleteOne({ _id: entryId, userId }, { session });
        });
      } finally { await session.endSession(); }
    },
    async receive(userId, installmentId, data) {
      const session = await mongoose.startSession(); let result;
      try {
        await session.withTransaction(async () => { result = await recordReceipt(userId, installmentId, data, session); });
      } finally { await session.endSession(); }
      return result;
    },
    async receiveMany(userId, installmentIds, paymentMethod, receivedOn) {
      const session = await mongoose.startSession(); const results = [];
      try {
        await session.withTransaction(async () => {
          for (const installmentId of installmentIds) {
            const installment = await CashInstallment.findOne({ _id: installmentId, userId }).session(session).lean();
            if (!installment) throw notFound('Uma ou mais parcelas não foram encontradas');
            const sum = (await receiptTotals(userId, [installment._id])).get(String(installment._id)) ?? 0;
            if (installment.amountCents <= sum) continue;
            results.push(await recordReceipt(userId, installmentId, {
              amount: money(installment.amountCents - sum), receivedOn, paymentMethod,
            }, session));
          }
        });
      } finally { await session.endSession(); }
      return results;
    },
    async undoReceipt(userId, receiptId) {
      const session = await mongoose.startSession(); let installmentId;
      try {
        await session.withTransaction(async () => {
          const receipt = await CashReceipt.findOne({ _id: receiptId, userId }).session(session);
          if (!receipt) throw notFound('Recebimento não encontrado');
          const installment = await CashInstallment.findOne({ _id: receipt.installmentId, userId }).session(session);
          installmentId = String(receipt.installmentId);
          await receipt.deleteOne({ session });
          if (installment) await CashEntry.updateOne({ _id: installment.entryId, userId, kind: 'refund', refundStatus: 'received' }, { $set: { refundStatus: 'in_review' } }, { session });
        });
      } finally { await session.endSession(); }
      return { installmentId };
    },
    async setRefundStatus(userId, entryId, status) {
      const entry = await entryOwned(userId, entryId);
      if (entry.kind !== 'refund') throw badRequest('O registro não é um reembolso');
      if (status === 'received') {
        const item = await CashInstallment.findOne({ entryId, userId });
        if (item) {
          const received = (await receiptTotals(userId, [item._id])).get(String(item._id)) ?? 0;
          if (received < item.amountCents) await this.receive(userId, item._id, {
            amount: money(item.amountCents - received), receivedOn: new Date().toISOString().slice(0, 10), paymentMethod: 'transfer',
          });
        }
      } else await CashEntry.updateOne({ _id: entryId, userId }, { $set: { refundStatus: status } });
      return loadEntry(userId, entryId);
    },
    async exportCsv(userId) {
      const entries = await CashEntry.find({ userId }).populate('personId', 'name').sort({ entryDate: 1 }).lean();
      const installments = await CashInstallment.find({ userId }).sort({ dueDate: 1, number: 1 }).lean();
      const totals = await receiptTotals(userId, installments.map((item) => item._id));
      const byEntry = new Map(entries.map((entry) => [String(entry._id), entry]));
      const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const lines = installments.map((item) => {
        const entry = byEntry.get(String(item.entryId)); const received = totals.get(String(item._id)) ?? 0;
        return [entry.kind, entry.description, entry.personId?.name || entry.counterparty || '', entry.entryDate, item.dueDate, `${item.number}/${item.count}`, money(item.amountCents), money(received), money(Math.max(0, item.amountCents - received)), entry.paymentMethod, entry.refundStatus];
      });
      const expensesWithoutInstallments = entries.filter((entry) => entry.kind === 'expense').map((entry) => [
        entry.kind, entry.description, entry.personId?.name || entry.counterparty || '', entry.entryDate, '',
        '', money(entry.totalCents), 0, money(entry.totalCents), entry.paymentMethod, '',
      ]);
      return [['Tipo', 'Descrição', 'Pessoa', 'Data', 'Vencimento', 'Parcela', 'Valor', 'Recebido', 'Saldo', 'Forma', 'Status'], ...expensesWithoutInstallments, ...lines].map((line) => line.map(escape).join(';')).join('\r\n');
    },
  };
}
