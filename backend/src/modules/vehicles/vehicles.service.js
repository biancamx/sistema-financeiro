import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { round2 } from '../../lib/months.js';
import { generateCardInstallments, splitWeighted } from '../../lib/cardBilling.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { Installment } from '../../models/Installment.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { Vehicle } from '../../models/Vehicle.js';
import { VehicleExpense } from '../../models/VehicleExpense.js';
import { EXPENSE_CATEGORIES, EXPENSE_GROUPS, groupOf } from './vehicles.categories.js';

export const normalizePlate = (plate) => String(plate).toUpperCase().replace(/[\s-]/g, '');
const idString = (value) => value ? String(value._id ?? value) : null;

export function createVehiclesService() {
  const assertOwned = async (Model, id, userId, label) => {
    if (!await Model.exists({ _id: id, userId })) throw badRequest(`${label} inválido(a)`);
  };
  const getVehicle = async (userId, id) => {
    const vehicle = await Vehicle.findOne({ _id: id, userId }).populate('ownerId', 'name avatar').lean();
    if (!vehicle) throw notFound('Veículo não encontrado');
    const expenses = await VehicleExpense.find({ userId, vehicleId: id }).select('amount km expenseDate').lean();
    return {
      id: String(vehicle._id), kind: vehicle.kind, model: vehicle.model, plate: vehicle.plate,
      year: vehicle.year, purchaseValue: vehicle.purchaseValue, status: vehicle.status,
      ownerId: idString(vehicle.ownerId), ownerName: vehicle.ownerId?.name ?? null, ownerAvatar: vehicle.ownerId?.avatar ?? null,
      soldDate: vehicle.soldDate, soldValue: vehicle.soldValueCents == null ? null : round2(vehicle.soldValueCents / 100),
      notes: vehicle.notes, totalSpent: round2(expenses.reduce((sum, item) => sum + item.amount, 0)),
      expensesCount: expenses.length,
      currentKm: expenses.some((item) => item.km != null) ? Math.max(...expenses.map((item) => item.km).filter((km) => km != null)) : null,
      lastExpenseDate: expenses.map((item) => item.expenseDate).sort().at(-1) ?? null,
    };
  };
  const computeShares = async (userId, data, amount) => {
    await assertOwned(Person, data.payerId, userId, 'Pessoa pagadora');
    if (!data.shared) return [{ personId: data.payerId, amount }];
    const participants = data.participants;
    for (const part of participants) await assertOwned(Person, part.personId, userId, 'Pessoa');
    const toCents = (value) => Math.round((value ?? 0) * 100);
    let weights;
    if (data.splitMode === 'percent') {
      weights = participants.map((part) => toCents(part.value));
      if (Math.abs(weights.reduce((a, b) => a + b, 0) - 10000) > 1) throw badRequest('A soma das porcentagens deve ser 100%');
    } else if (data.splitMode === 'amount') {
      weights = participants.map((part) => toCents(part.value));
      if (Math.abs(weights.reduce((a, b) => a + b, 0) - toCents(amount)) > 1) throw badRequest('A soma dos valores de cada pessoa deve ser igual ao valor do gasto');
    } else weights = participants.map(() => 1);
    if (weights.some((weight) => weight <= 0)) throw badRequest('Cada participante precisa ter uma parte maior que zero');
    const values = splitWeighted(amount, weights);
    return participants.map((part, index) => ({ personId: part.personId, amount: values[index] }));
  };
  const categoryNames = (key, kind) => {
    const label = EXPENSE_CATEGORIES.find((item) => item.key === key)?.label ?? key;
    if (key === 'ipva') return [kind === 'motorcycle' ? 'IPVA moto' : 'IPVA carro', 'IPVA', label, 'Carro'];
    if (key === 'licensing') return [kind === 'motorcycle' ? 'Licenciamento moto' : 'Licenciamento carro', 'Licenciamento', label, 'Carro'];
    if (key === 'insurance') return ['Seguro carro', 'Seguro', label, 'Carro'];
    if (key === 'financing') return ['Consórcio', 'Financiamento', label, 'Carro'];
    if (key === 'fuel') return ['Vale combustível', 'Combustível', label, 'Carro'];
    return [label, 'Carro'];
  };
  const linkedCategory = async (userId, category, kind, session) => {
    const candidates = categoryNames(category, kind).map((value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'));
    const categories = await Category.find({ userId }).session(session).lean();
    const existing = categories.find((item) => candidates.includes(item.name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')));
    if (existing) return existing._id;
    const [created] = await Category.create([{ userId, name: categoryNames(category, kind)[0] }], { session });
    return created._id;
  };
  const createLinkedPurchases = async (userId, expense, shares, vehicle, session, paidAmounts = new Map()) => {
    const card = await Card.findOne({ _id: expense.cardId, userId }).session(session).lean();
    if (!card) throw badRequest('Cartão inválido');
    const count = expense.paymentMethod === 'card' ? expense.installmentCount : 1;
    const categoryId = await linkedCategory(userId, expense.category, vehicle.kind, session);
    const label = EXPENSE_CATEGORIES.find((item) => item.key === expense.category)?.label ?? expense.category;
    const description = `Veículo ${vehicle.model} · ${expense.description?.trim() || label}`.slice(0, 120);
    const schedule = generateCardInstallments({
      total: round2(expense.amount), count, purchaseDate: expense.date, card,
      startYear: expense.startYear, startMonth: expense.startMonth,
    });
    const group = expense.shared ? randomUUID() : null;
    const sharedSchedule = expense.shared ? schedule.map((item, index) => ({
      ...item, shares: splitWeighted(item.amount, shares.map((share) => Math.round(share.amount * 100)), index),
    })) : schedule;
    if (expense.shared && sharedSchedule.some((item) => item.shares.some((value) => value <= 0))) throw badRequest('Valor pequeno demais para dividir desse jeito entre as pessoas e parcelas');
    const parts = expense.shared ? shares : [{ personId: expense.payerId, amount: expense.amount }];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const rows = expense.shared ? sharedSchedule.map((item) => ({ ...item, amount: item.shares[index] })) : sharedSchedule;
      const totalAmount = round2(rows.reduce((sum, item) => sum + item.amount, 0));
      const [purchase] = await Purchase.create([{
        userId, description, categoryId, personId: part.personId, cardId: expense.cardId,
        purchaseDate: expense.date, totalAmount, totalInstallments: count,
        splitGroupId: group, observation: expense.observation ?? '', vehicleExpenseId: expense._id,
      }], { session });
      await Installment.insertMany(rows.map((item) => {
        const paidAmount = Math.min(item.amount, Math.max(0, paidAmounts.get(`${String(part.personId)}:${item.number}`) ?? 0));
        return {
          userId, purchaseId: purchase._id, number: item.number, year: item.year, month: item.month,
          amount: item.amount, paidAmount, paid: paidAmount >= item.amount - 0.005,
        };
      }), { session });
    }
  };
  const syncLinkedPurchases = async (userId, expense, shares, vehicle, session) => {
    const purchases = await Purchase.find({ userId, vehicleExpenseId: expense._id }).session(session).lean();
    const observation = purchases[0]?.observation ?? '';
    const paidRows = purchases.length ? await Installment.find({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }).session(session).lean() : [];
    const paidAmounts = new Map();
    for (const row of paidRows) {
      const purchase = purchases.find((item) => String(item._id) === String(row.purchaseId));
      if (purchase) paidAmounts.set(`${String(purchase.personId)}:${row.number}`, row.paidAmount);
    }
    await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
    await Purchase.deleteMany({ userId, vehicleExpenseId: expense._id }, { session });
    if (expense.paymentMethod === 'card') await createLinkedPurchases(userId, { ...expense, observation }, shares, vehicle, session, paidAmounts);
  };
  const expenseShape = async (userId, expense) => {
    const [vehicle, payer, shares] = await Promise.all([
      Vehicle.findOne({ _id: expense.vehicleId, userId }).select('model plate').lean(),
      Person.findOne({ _id: expense.payerId, userId }).select('name').lean(),
      Promise.all(expense.shares.map(async (share) => ({
        personId: String(share.personId),
        person: (await Person.findOne({ _id: share.personId, userId }).select('name').lean())?.name ?? '',
        amount: share.amount,
      }))),
    ]);
    const label = EXPENSE_CATEGORIES.find((item) => item.key === expense.category)?.label ?? expense.category;
    const purchase = await Purchase.findOne({ userId, vehicleExpenseId: expense._id }).populate('cardId', 'name').lean();
    const installments = purchase ? await Installment.find({ userId, purchaseId: purchase._id }).sort({ number: 1 }).lean() : [];
    const first = installments[0];
    return {
      id: String(expense._id), vehicleId: String(expense.vehicleId), vehicleModel: vehicle?.model ?? '',
      vehiclePlate: vehicle?.plate ?? '', date: expense.expenseDate, category: expense.category,
      description: expense.description, amount: expense.amount, km: expense.km, payerId: String(expense.payerId),
      payer: payer?.name ?? '', shared: expense.shared, splitMode: expense.splitMode,
      paymentMethod: expense.paymentMethod, requestId: expense.requestId,
      cardId: purchase?.cardId ? String(purchase.cardId._id) : null, card: purchase?.cardId?.name ?? null,
      installmentCount: purchase?.totalInstallments ?? 1, startMonth: first?.month ?? null, startYear: first?.year ?? null,
      group: groupOf(expense.category), categoryLabel: label, shares,
    };
  };
  const filterExpenses = (userId, query) => {
    const filter = { userId };
    if (query.vehicleId) filter.vehicleId = query.vehicleId;
    if (query.category) filter.category = query.category;
    if (query.group) filter.category = { $in: EXPENSE_CATEGORIES.filter((item) => item.group === query.group).map((item) => item.key) };
    if (query.personId) filter.$or = [{ payerId: query.personId }, { 'shares.personId': query.personId }];
    if (query.shared !== undefined) filter.shared = query.shared;
    if (query.year) filter.expenseDate = { ...(filter.expenseDate ?? {}), $gte: `${query.year}-01-01`, $lte: `${query.year}-12-31` };
    if (query.from) filter.expenseDate = { ...(filter.expenseDate ?? {}), $gte: query.from };
    if (query.to) filter.expenseDate = { ...(filter.expenseDate ?? {}), $lte: query.to };
    if (query.search) filter.description = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    return filter;
  };
  const getExpense = async (userId, id) => {
    const expense = await VehicleExpense.findOne({ _id: id, userId }).lean();
    if (!expense) throw notFound('Lançamento não encontrado');
    return expenseShape(userId, expense);
  };

  return {
    categories: () => ({ groups: EXPENSE_GROUPS, categories: EXPENSE_CATEGORIES }),
    async listVehicles(userId) {
      const vehicles = await Vehicle.find({ userId }).populate('ownerId', 'name avatar').sort({ status: -1, model: 1 }).lean();
      return Promise.all(vehicles.map((vehicle) => getVehicle(userId, vehicle._id)));
    },
    getVehicle,
    async createVehicle(userId, data) {
      const plate = normalizePlate(data.plate);
      if (await Vehicle.exists({ userId, plate })) throw conflict('Já existe um veículo com esta placa');
      if (data.ownerId) await assertOwned(Person, data.ownerId, userId, 'Proprietário');
      const vehicle = await Vehicle.create({
        userId, kind: data.kind, model: data.model, plate, year: data.year ?? null,
        purchaseValue: data.purchaseValue, ownerId: data.ownerId ?? null, status: data.status, notes: data.notes || null,
      });
      return getVehicle(userId, vehicle._id);
    },
    async updateVehicle(userId, id, data) {
      await this.getVehicle(userId, id);
      const plate = normalizePlate(data.plate);
      if (await Vehicle.exists({ userId, plate, _id: { $ne: id } })) throw conflict('Já existe um veículo com esta placa');
      if (data.ownerId) await assertOwned(Person, data.ownerId, userId, 'Proprietário');
      await Vehicle.updateOne({ _id: id, userId }, { $set: {
        kind: data.kind, model: data.model, plate, year: data.year ?? null, purchaseValue: data.purchaseValue,
        ownerId: data.ownerId ?? null, status: data.status, notes: data.notes || null,
      } });
      return getVehicle(userId, id);
    },
    async removeVehicle(userId, id, force = false) {
      const vehicle = await this.getVehicle(userId, id);
      if (vehicle.expensesCount && !force) throw conflict(`Este veículo tem ${vehicle.expensesCount} lançamento(s). Para manter o histórico, marque-o como Vendido ou Inativo; excluir apaga tudo.`);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const expenses = await VehicleExpense.find({ userId, vehicleId: id }).select('_id').session(session);
          const expenseIds = expenses.map((item) => item._id);
          const purchases = await Purchase.find({ userId, vehicleExpenseId: { $in: expenseIds } }).select('_id').session(session);
          await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
          await Purchase.deleteMany({ userId, vehicleExpenseId: { $in: expenseIds } }, { session });
          await VehicleExpense.deleteMany({ userId, vehicleId: id }, { session });
          await Vehicle.deleteOne({ _id: id, userId }, { session });
        });
      } finally { await session.endSession(); }
    },
    async listExpenses(userId, query) {
      const filter = filterExpenses(userId, query);
      const [rows, totalRows, sumRows] = await Promise.all([
        VehicleExpense.find(filter).sort({ expenseDate: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
        VehicleExpense.countDocuments(filter),
        VehicleExpense.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      ]);
      return {
        data: await Promise.all(rows.map((row) => expenseShape(userId, row))),
        page: query.page, pageSize: query.pageSize, total: totalRows, sum: round2(sumRows[0]?.total ?? 0),
      };
    },
    getExpense,
    async createExpense(userId, data) {
      await assertOwned(Vehicle, data.vehicleId, userId, 'Veículo');
      if (data.paymentMethod === 'card') await assertOwned(Card, data.cardId, userId, 'Cartão');
      const amount = round2(data.amount);
      const shares = await computeShares(userId, data, amount);
      const session = await mongoose.startSession();
      let id;
      try {
        await session.withTransaction(async () => {
          if (data.requestId) {
            const prior = await VehicleExpense.findOne({ userId, requestId: data.requestId }).session(session);
            if (prior) { id = prior._id; return; }
          }
          const [expense] = await VehicleExpense.create([{
            userId, vehicleId: data.vehicleId, expenseDate: data.date, category: data.category,
            description: data.description ?? '', amount, km: data.km ?? null, payerId: data.payerId,
            shared: data.shared, splitMode: data.shared ? data.splitMode : 'equal', paymentMethod: data.paymentMethod,
            requestId: data.requestId ?? null,
            shares,
          }], { session });
          id = expense._id;
          if (data.paymentMethod === 'card') {
            const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).session(session).lean();
            await createLinkedPurchases(userId, { ...data, amount, _id: expense._id }, shares, vehicle, session);
          }
        });
      } finally { await session.endSession(); }
      return getExpense(userId, id);
    },
    async updateExpense(userId, id, data) {
      await getExpense(userId, id);
      await assertOwned(Vehicle, data.vehicleId, userId, 'Veículo');
      if (data.paymentMethod === 'card') await assertOwned(Card, data.cardId, userId, 'Cartão');
      const amount = round2(data.amount);
      const shares = await computeShares(userId, data, amount);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const expense = await VehicleExpense.findOne({ _id: id, userId }).session(session);
          Object.assign(expense, {
            vehicleId: data.vehicleId, expenseDate: data.date, category: data.category,
            description: data.description ?? '', amount, km: data.km ?? null, payerId: data.payerId,
            shared: data.shared, splitMode: data.shared ? data.splitMode : 'equal',
            paymentMethod: data.paymentMethod, shares,
          });
          await expense.save({ session });
          const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).session(session).lean();
          await syncLinkedPurchases(userId, { ...data, amount, _id: expense._id }, shares, vehicle, session);
        });
      } finally { await session.endSession(); }
      return getExpense(userId, id);
    },
    async removeExpense(userId, id) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const expense = await VehicleExpense.findOne({ _id: id, userId }).session(session);
          if (!expense) throw notFound('Lançamento não encontrado');
          const purchases = await Purchase.find({ userId, vehicleExpenseId: expense._id }).select('_id').session(session);
          await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
          await Purchase.deleteMany({ userId, vehicleExpenseId: expense._id }, { session });
          await expense.deleteOne({ session });
        });
      } finally { await session.endSession(); }
    },
    async summary(userId, { vehicleId, year } = {}) {
      if (vehicleId) await this.getVehicle(userId, vehicleId);
      const filter = filterExpenses(userId, { vehicleId, year });
      const expenses = await VehicleExpense.find(filter).populate('payerId', 'name').lean();
      const total = expenses.reduce((sum, item) => sum + item.amount, 0);
      const byCategory = EXPENSE_CATEGORIES.map((category) => {
        const rows = expenses.filter((item) => item.category === category.key);
        return { key: category.key, label: category.label, group: category.group, count: rows.length, total: round2(rows.reduce((sum, item) => sum + item.amount, 0)) };
      }).filter((item) => item.count).sort((a, b) => b.total - a.total);
      const byGroup = EXPENSE_GROUPS.map((group) => {
        const rows = byCategory.filter((item) => item.group === group.key);
        return { key: group.key, label: group.label, count: rows.reduce((sum, item) => sum + item.count, 0), total: round2(rows.reduce((sum, item) => sum + item.total, 0)) };
      });
      const monthMap = new Map();
      for (const item of expenses) {
        const [y, m] = item.expenseDate.split('-').map(Number);
        const key = `${y}-${m}`;
        monthMap.set(key, (monthMap.get(key) ?? 0) + item.amount);
      }
      const byMonth = year
        ? Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, total: round2(monthMap.get(`${year}-${i + 1}`) ?? 0) }))
        : [...monthMap].map(([key, amount]) => { const [y, m] = key.split('-').map(Number); return { year: y, month: m, total: round2(amount) }; }).sort((a, b) => a.year - b.year || a.month - b.month);
      const vehicles = await Vehicle.find({ userId, ...(vehicleId && { _id: vehicleId }) }).select('model plate').lean();
      const byVehicle = await Promise.all(vehicles.map(async (vehicle) => {
        const records = await VehicleExpense.find({ userId, vehicleId: vehicle._id, ...(year && { expenseDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }) }).select('amount').lean();
        return { vehicleId: String(vehicle._id), label: `${vehicle.model} · ${vehicle.plate}`, count: records.length, total: round2(records.reduce((sum, item) => sum + item.amount, 0)) };
      }));
      const paid = new Map(); const owes = new Map(); const ids = new Set();
      for (const expense of expenses) {
        const payer = String(expense.payerId._id); ids.add(payer); paid.set(payer, (paid.get(payer) ?? 0) + expense.amount);
        for (const share of expense.shares) {
          const person = String(share.personId); ids.add(person); owes.set(person, (owes.get(person) ?? 0) + share.amount);
        }
      }
      const people = await Person.find({ userId, _id: { $in: [...ids] } }).select('name').lean();
      const personMap = new Map(people.map((person) => [String(person._id), person.name]));
      const balances = [...ids].map((personId) => {
        const paidValue = round2(paid.get(personId) ?? 0); const owedValue = round2(owes.get(personId) ?? 0);
        return { personId, name: personMap.get(personId) ?? '', paid: paidValue, owes: owedValue, balance: round2(paidValue - owedValue) };
      }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      const out = { year: year ?? null, total: round2(total), count: expenses.length, byGroup, byCategory, byMonth, byVehicle, people: balances };
      if (vehicleId) {
        const all = await VehicleExpense.find({ userId, vehicleId }).select('amount km expenseDate description category').sort({ expenseDate: -1, _id: -1 }).lean();
        const kms = all.map((item) => item.km).filter((km) => km != null);
        out.recentExpenses = all.filter((item) => {
          const [label] = item.expenseDate.split('T');
          return !year || label.startsWith(String(year));
        }).slice(0, 8).map((item) => ({
          id: String(item._id), date: item.expenseDate, category: item.category, description: item.description,
          amount: item.amount, km: item.km,
          categoryLabel: EXPENSE_CATEGORIES.find((category) => category.key === item.category)?.label ?? item.category,
        }));
        out.currentKm = kms.length ? Math.max(...kms) : null;
        out.kmSpan = kms.length ? Math.max(...kms) - Math.min(...kms) : 0;
        out.costPerKm = out.kmSpan > 0 ? round2(all.reduce((sum, item) => sum + item.amount, 0) / out.kmSpan) : null;
      }
      return out;
    },
    async exportCsv(userId, query = {}) {
      const rows = await VehicleExpense.find(filterExpenses(userId, query)).sort({ expenseDate: 1, _id: 1 }).lean();
      const data = await Promise.all(rows.map((row) => expenseShape(userId, row)));
      const esc = (value) => {
        let text = value == null ? '' : String(value);
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const groups = new Map(EXPENSE_GROUPS.map((group) => [group.key, group.label]));
      const head = ['Data', 'Veículo', 'Placa', 'Grupo', 'Categoria', 'Descrição', 'Valor', 'KM', 'Pagou', 'Tipo', 'Rateio'];
      const lines = data.map((row) => [
        row.date, row.vehicleModel, row.vehiclePlate, groups.get(row.group), row.categoryLabel, row.description,
        row.amount, row.km, row.payer, row.shared ? 'Compartilhado' : 'Individual',
        row.shares.map((share) => `${share.person}: ${share.amount.toFixed(2)}`).join(' | '),
      ]);
      return [head, ...lines].map((line) => line.map(esc).join(';')).join('\n');
    },
  };
}
