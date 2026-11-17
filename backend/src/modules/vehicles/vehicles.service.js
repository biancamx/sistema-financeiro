import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { round2 } from '../../lib/months.js';
import { generateCardInstallments, splitWeighted } from '../../lib/cardBilling.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { CashEntry } from '../../models/CashEntry.js';
import { Installment } from '../../models/Installment.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { Vehicle } from '../../models/Vehicle.js';
import { VehicleDocument } from '../../models/VehicleDocument.js';
import { VehicleExpense } from '../../models/VehicleExpense.js';
import { VehicleReminder } from '../../models/VehicleReminder.js';
import { completeReminderFromExpense, listVehicleReminders } from './vehicle-reminders.service.js';
import { deleteVehicleFile, getVehicleFile, uploadVehicleFile } from './vehicle-files.storage.js';
import { EXPENSE_CATEGORIES, EXPENSE_GROUPS, groupOf } from './vehicles.categories.js';

export const normalizePlate = (plate) => String(plate).toUpperCase().replace(/[\s-]/g, '');
const idString = (value) => value ? String(value._id ?? value) : null;

export function createVehiclesService() {
  const assertOwned = async (Model, id, userId, label) => {
    if (!await Model.exists({ _id: id, userId })) throw badRequest(`${label} inválido(a)`);
  };
  const advanceVehicleMileage = async (userId, vehicleId, newKm, expenseId, session) => {
    const vehicle = await Vehicle.findOne({ _id: vehicleId, userId }).select('currentKm').session(session);
    if (!vehicle) throw notFound('Veículo não encontrado');
    const highestExpense = await VehicleExpense.findOne({ userId, vehicleId, _id: { $ne: expenseId }, km: { $ne: null } })
      .sort({ km: -1 }).select('km').session(session).lean();
    const baselineKm = vehicle.currentKm ?? highestExpense?.km ?? null;
    if (newKm != null && (baselineKm == null || newKm > baselineKm)) {
      vehicle.currentKm = newKm;
      await vehicle.save({ session });
    } else if (vehicle.currentKm == null && highestExpense?.km != null) {
      vehicle.currentKm = highestExpense.km;
      await vehicle.save({ session });
    }
  };
  const preserveMileageBeforeExpenseRemoval = async (userId, vehicleId, session) => {
    const vehicle = await Vehicle.findOne({ _id: vehicleId, userId }).select('currentKm').session(session);
    if (!vehicle || vehicle.currentKm != null) return;
    const highestExpense = await VehicleExpense.findOne({ userId, vehicleId, km: { $ne: null } })
      .sort({ km: -1 }).select('km').session(session).lean();
    if (highestExpense?.km != null) {
      vehicle.currentKm = highestExpense.km;
      await vehicle.save({ session });
    }
  };
  const getVehicle = async (userId, id) => {
    const vehicle = await Vehicle.findOne({ _id: id, userId }).populate('ownerId', 'name avatar').lean();
    if (!vehicle) throw notFound('Veículo não encontrado');
    const expenses = await VehicleExpense.find({ userId, vehicleId: id }).select('amount km expenseDate').lean();
    const expenseKm = expenses.map((item) => item.km).filter((km) => km != null);
    return {
      id: String(vehicle._id), kind: vehicle.kind, model: vehicle.model, plate: vehicle.plate,
      year: vehicle.year, purchaseValue: vehicle.purchaseValue, currentKm: vehicle.currentKm ?? (expenseKm.length ? Math.max(...expenseKm) : null),
      insuranceDueDate: vehicle.insuranceDueDate, photoUrl: vehicle.photoUrl, photoThumbnailUrl: vehicle.photoThumbnailUrl,
      status: vehicle.status,
      ownerId: idString(vehicle.ownerId), ownerName: vehicle.ownerId?.name ?? null, ownerAvatar: vehicle.ownerId?.avatar ?? null,
      soldDate: vehicle.soldDate, soldValue: vehicle.soldValueCents == null ? null : round2(vehicle.soldValueCents / 100),
      notes: vehicle.notes, totalSpent: round2(expenses.reduce((sum, item) => sum + item.amount, 0)),
      expensesCount: expenses.length,
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
  const syncCashEntry = async (userId, expense, vehicle, session) => {
    const filter = { userId, vehicleExpenseId: expense._id };
    if (expense.paymentMethod !== 'cash') {
      await CashEntry.deleteMany(filter, { session });
      return;
    }
    if (!vehicle) throw notFound('Veículo associado ao gasto não foi encontrado.');
    const categoryId = await linkedCategory(userId, expense.category, vehicle.kind, session);
    const label = EXPENSE_CATEGORIES.find((item) => item.key === expense.category)?.label ?? expense.category;
    await CashEntry.updateOne(filter, {
      $set: {
        kind: 'expense',
        description: expense.description?.trim() || label,
        totalCents: Math.round(expense.amount * 100),
        categoryId,
        personId: expense.payerId,
        counterparty: null,
        entryDate: expense.expenseDate,
        paymentMethod: 'cash',
        downPaymentCents: 0,
        installmentCount: 1,
        firstDueDate: null,
        frequency: 'monthly',
        loanTerm: null,
        interestRateBps: 0,
        protocol: null,
        expectedReturnDate: null,
        refundStatus: null,
        vehicleId: expense.vehicleId,
        notes: '',
      },
      $setOnInsert: { userId, vehicleExpenseId: expense._id },
    }, { upsert: true, ...(session && { session }) });
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
      description: expense.description, amount: expense.amount, km: expense.km, liters: expense.liters ?? null,
      payerId: String(expense.payerId),
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
  const syncInsuranceReminder = async (userId, vehicleId, dueDate) => {
    const filter = { userId, vehicleId, source: 'insurance' };
    if (!dueDate) {
      await VehicleReminder.deleteMany(filter);
      return;
    }
    await VehicleReminder.findOneAndUpdate(
      filter,
      {
        $set: { type: 'insurance', rule: 'fixed_date', dueDate, active: true, paidAt: null, notifiedStatus: null },
        $setOnInsert: {
          userId, vehicleId, source: 'insurance', title: '',
          intervalKm: null, intervalMonths: null, lastPerformedDate: null, lastPerformedKm: null,
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  };

  return {
    categories: () => ({ groups: EXPENSE_GROUPS, categories: EXPENSE_CATEGORIES }),
    async syncCashEntries(userId) {
      const expenses = await VehicleExpense.find({ userId, paymentMethod: 'cash' }).lean();
      if (!expenses.length) return;
      const expenseIds = expenses.map((item) => item._id);
      const linked = await CashEntry.find({ userId, vehicleExpenseId: { $in: expenseIds } }).select('vehicleExpenseId').lean();
      const linkedIds = new Set(linked.map((item) => String(item.vehicleExpenseId)));
      const vehicleIds = [...new Set(expenses.map((item) => String(item.vehicleId)))];
      const vehicles = await Vehicle.find({ userId, _id: { $in: vehicleIds } }).select('model kind').lean();
      const vehiclesById = new Map(vehicles.map((item) => [String(item._id), item]));
      for (const expense of expenses) {
        if (linkedIds.has(String(expense._id))) continue;
        const vehicle = vehiclesById.get(String(expense.vehicleId));
        if (!vehicle) throw notFound('Veículo associado a um gasto em dinheiro não foi encontrado.');
        try {
          await syncCashEntry(userId, expense, vehicle);
        } catch (error) {
          if (error?.code !== 11000) throw error;
          if (!await CashEntry.exists({ userId, vehicleExpenseId: expense._id })) throw error;
        }
      }
    },
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
        purchaseValue: data.purchaseValue, currentKm: data.currentKm ?? null,
        insuranceDueDate: data.insuranceDueDate ?? null, ownerId: data.ownerId ?? null,
        status: data.status, notes: data.notes || null,
      });
      await syncInsuranceReminder(userId, vehicle._id, data.insuranceDueDate ?? null);
      return getVehicle(userId, vehicle._id);
    },
    async updateVehicle(userId, id, data) {
      await this.getVehicle(userId, id);
      const plate = normalizePlate(data.plate);
      if (await Vehicle.exists({ userId, plate, _id: { $ne: id } })) throw conflict('Já existe um veículo com esta placa');
      if (data.ownerId) await assertOwned(Person, data.ownerId, userId, 'Proprietário');
      const updates = {
        kind: data.kind, model: data.model, plate, year: data.year ?? null, purchaseValue: data.purchaseValue,
        ownerId: data.ownerId ?? null, status: data.status, notes: data.notes || null,
      };
      if (Object.hasOwn(data, 'currentKm')) updates.currentKm = data.currentKm ?? null;
      if (Object.hasOwn(data, 'insuranceDueDate')) {
        updates.insuranceDueDate = data.insuranceDueDate ?? null;
        await syncInsuranceReminder(userId, id, updates.insuranceDueDate);
      }
      await Vehicle.updateOne({ _id: id, userId }, { $set: updates });
      return getVehicle(userId, id);
    },
    async updateVehiclePhoto(userId, id, image, thumbnail) {
      const vehicle = await Vehicle.findOne({ _id: id, userId }).select('photoFileId photoThumbnailFileId').lean();
      if (!vehicle) throw notFound('Veículo não encontrado');
      const uploadedIds = [];
      try {
        const photoFileId = await uploadVehicleFile(image.buffer, {
          filename: `${id}-${randomUUID()}.${image.contentType.split('/')[1]}`,
          contentType: image.contentType,
          metadata: { userId: String(userId), vehicleId: String(id), purpose: 'vehicle-photo' },
        });
        uploadedIds.push(photoFileId);
        const photoThumbnailFileId = await uploadVehicleFile(thumbnail.buffer, {
          filename: `${id}-${randomUUID()}.${thumbnail.contentType.split('/')[1]}`,
          contentType: thumbnail.contentType,
          metadata: { userId: String(userId), vehicleId: String(id), purpose: 'vehicle-photo-thumbnail' },
        });
        uploadedIds.push(photoThumbnailFileId);
        await Vehicle.updateOne({ _id: id, userId }, { $set: {
          photoFileId,
          photoThumbnailFileId,
          photoContentType: image.contentType,
          photoThumbnailContentType: thumbnail.contentType,
          photoUrl: `/api/vehicles/${id}/photo`,
          photoThumbnailUrl: `/api/vehicles/${id}/photo/thumbnail`,
        } });
      } catch (error) {
        const cleanup = await Promise.allSettled(uploadedIds.map((fileId) => deleteVehicleFile(fileId)));
        const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
        if (failures.length) throw new AggregateError([error, ...failures], 'Falha ao salvar a foto e limpar arquivos temporários.');
        throw error;
      }
      if (vehicle.photoFileId) await deleteVehicleFile(vehicle.photoFileId);
      if (vehicle.photoThumbnailFileId) await deleteVehicleFile(vehicle.photoThumbnailFileId);
      return getVehicle(userId, id);
    },
    async removeVehiclePhoto(userId, id) {
      const vehicle = await Vehicle.findOne({ _id: id, userId }).select('photoFileId photoThumbnailFileId').lean();
      if (!vehicle) throw notFound('Veículo não encontrado');
      await Vehicle.updateOne({ _id: id, userId }, { $set: {
        photoFileId: null, photoThumbnailFileId: null, photoContentType: null,
        photoThumbnailContentType: null, photoUrl: null, photoThumbnailUrl: null,
      } });
      if (vehicle.photoFileId) await deleteVehicleFile(vehicle.photoFileId);
      if (vehicle.photoThumbnailFileId) await deleteVehicleFile(vehicle.photoThumbnailFileId);
    },
    async getVehiclePhoto(userId, id, thumbnail = false) {
      const vehicle = await Vehicle.findOne({ _id: id, userId })
        .select(thumbnail
          ? 'photoThumbnailFileId photoThumbnailContentType'
          : 'photoFileId photoContentType').lean();
      if (!vehicle) throw notFound('Veículo não encontrado');
      const fileId = thumbnail ? vehicle.photoThumbnailFileId : vehicle.photoFileId;
      if (!fileId) throw notFound('Foto não encontrada');
      const file = await getVehicleFile(fileId);
      if (!file) throw notFound('Foto não encontrada');
      return { ...file, file: { ...file.file, contentType: thumbnail ? vehicle.photoThumbnailContentType : vehicle.photoContentType } };
    },
    async removeVehicle(userId, id, force = false) {
      const vehicle = await this.getVehicle(userId, id);
      if (vehicle.expensesCount && !force) throw conflict(`Este veículo tem ${vehicle.expensesCount} lançamento(s). Para manter o histórico, marque-o como Vendido ou Inativo; excluir apaga tudo.`);
      const session = await mongoose.startSession();
      let photoFileIds = [];
      let documentFileIds = [];
      try {
        await session.withTransaction(async () => {
          const expenses = await VehicleExpense.find({ userId, vehicleId: id }).select('_id').session(session);
          const expenseIds = expenses.map((item) => item._id);
          const vehicle = await Vehicle.findOne({ _id: id, userId }).select('photoFileId photoThumbnailFileId').session(session).lean();
          photoFileIds = [vehicle?.photoFileId, vehicle?.photoThumbnailFileId].filter(Boolean);
          const documents = await VehicleDocument.find({ userId, vehicleId: id }).select('fileId').session(session).lean();
          documentFileIds = documents.map((document) => document.fileId);
          const purchases = await Purchase.find({ userId, vehicleExpenseId: { $in: expenseIds } }).select('_id').session(session);
          await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
          await Purchase.deleteMany({ userId, vehicleExpenseId: { $in: expenseIds } }, { session });
          await CashEntry.deleteMany({ userId, vehicleExpenseId: { $in: expenseIds } }, { session });
          await VehicleExpense.deleteMany({ userId, vehicleId: id }, { session });
          await VehicleDocument.deleteMany({ userId, vehicleId: id }, { session });
          await VehicleReminder.deleteMany({ userId, vehicleId: id }, { session });
          await Vehicle.deleteOne({ _id: id, userId }, { session });
        });
      } finally { await session.endSession(); }
      await Promise.all([...photoFileIds, ...documentFileIds].map((fileId) => deleteVehicleFile(fileId)));
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
            if (prior) {
              id = prior._id;
              if (prior.paymentMethod === 'cash') {
                const vehicle = await Vehicle.findOne({ _id: prior.vehicleId, userId }).session(session).lean();
                await syncCashEntry(userId, prior, vehicle, session);
              }
              return;
            }
          }
          const [expense] = await VehicleExpense.create([{
            userId, vehicleId: data.vehicleId, expenseDate: data.date, category: data.category,
            description: data.description ?? '', amount, km: data.km ?? null, liters: data.liters ?? null, payerId: data.payerId,
            shared: data.shared, splitMode: data.shared ? data.splitMode : 'equal', paymentMethod: data.paymentMethod,
            requestId: data.requestId ?? null,
            shares,
          }], { session });
          id = expense._id;
          await advanceVehicleMileage(userId, data.vehicleId, data.km ?? null, expense._id, session);
          if (data.reminderId) await completeReminderFromExpense(userId, data.reminderId, data, session);
          const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).session(session).lean();
          if (data.paymentMethod === 'cash') {
            await syncCashEntry(userId, expense, vehicle, session);
          } else {
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
            description: data.description ?? '', amount, km: data.km ?? null, liters: data.liters ?? null, payerId: data.payerId,
            shared: data.shared, splitMode: data.shared ? data.splitMode : 'equal',
            paymentMethod: data.paymentMethod, shares,
          });
          await expense.save({ session });
          await advanceVehicleMileage(userId, data.vehicleId, data.km ?? null, expense._id, session);
          const vehicle = await Vehicle.findOne({ _id: data.vehicleId, userId }).session(session).lean();
          await syncCashEntry(userId, { ...data, amount, _id: expense._id, expenseDate: data.date, payerId: data.payerId }, vehicle, session);
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
          await preserveMileageBeforeExpenseRemoval(userId, expense.vehicleId, session);
          const purchases = await Purchase.find({ userId, vehicleExpenseId: expense._id }).select('_id').session(session);
          await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
          await Purchase.deleteMany({ userId, vehicleExpenseId: expense._id }, { session });
          await CashEntry.deleteMany({ userId, vehicleExpenseId: expense._id }, { session });
          await expense.deleteOne({ session });
        });
      } finally { await session.endSession(); }
    },
    async summary(userId, { vehicleId, year, period, month } = {}) {
      const now = new Date();
      const selectedYear = year ?? now.getFullYear();
      const selectedMonth = month ?? now.getMonth() + 1;
      const selectedPeriod = period ?? (year ? 'year' : 'all');
      const selectedVehicle = vehicleId ? await this.getVehicle(userId, vehicleId) : null;

      const dateRange = (rangePeriod, rangeYear, rangeMonth) => {
        if (rangePeriod === 'all') return null;
        if (rangePeriod === 'year') return { from: `${rangeYear}-01-01`, to: `${rangeYear}-12-31` };
        const firstMonth = rangePeriod === 'quarter' ? Math.floor((rangeMonth - 1) / 3) * 3 + 1 : rangeMonth;
        const lastMonth = rangePeriod === 'quarter' ? firstMonth + 2 : firstMonth;
        const lastDay = new Date(Date.UTC(rangeYear, lastMonth, 0)).getUTCDate();
        return {
          from: `${rangeYear}-${String(firstMonth).padStart(2, '0')}-01`,
          to: `${rangeYear}-${String(lastMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        };
      };
      const selectedRange = dateRange(selectedPeriod, selectedYear, selectedMonth);
      const filter = filterExpenses(userId, { vehicleId, ...selectedRange });
      const expenses = await VehicleExpense.find(filter).populate('payerId', 'name').populate('vehicleId', 'model plate').lean();
      const total = round2(expenses.reduce((sum, item) => sum + item.amount, 0));
      const byCategory = EXPENSE_CATEGORIES.map((category) => {
        const rows = expenses.filter((item) => item.category === category.key);
        return { key: category.key, label: category.label, group: category.group, count: rows.length, total: round2(rows.reduce((sum, item) => sum + item.amount, 0)) };
      }).filter((item) => item.count).sort((a, b) => b.total - a.total);
      const byGroup = EXPENSE_GROUPS.map((group) => {
        const rows = byCategory.filter((item) => item.group === group.key);
        return { key: group.key, label: group.label, count: rows.reduce((sum, item) => sum + item.count, 0), total: round2(rows.reduce((sum, item) => sum + item.total, 0)) };
      });
      const chartYear = year ?? now.getFullYear();
      const yearExpenses = await VehicleExpense.find(filterExpenses(userId, {
        vehicleId, from: `${chartYear}-01-01`, to: `${chartYear}-12-31`,
      })).select('amount expenseDate').lean();
      const ownershipTotal = round2(yearExpenses.reduce((sum, item) => sum + item.amount, 0));
      const monthMap = new Map();
      for (const item of yearExpenses) {
        const [y, m] = item.expenseDate.split('-').map(Number);
        const key = `${y}-${m}`;
        monthMap.set(key, (monthMap.get(key) ?? 0) + item.amount);
      }
      const byMonth = Array.from({ length: 12 }, (_, i) => ({
        year: chartYear, month: i + 1, total: round2(monthMap.get(`${chartYear}-${i + 1}`) ?? 0),
        current: chartYear === now.getFullYear() && i + 1 === now.getMonth() + 1,
      }));
      const vehicles = await Vehicle.find({ userId, ...(vehicleId && { _id: vehicleId }) })
        .select('model plate purchaseValue currentKm').lean();
      const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));
      const vehicleTotals = new Map();
      for (const expense of expenses) {
        const id = String(expense.vehicleId._id ?? expense.vehicleId);
        const aggregate = vehicleTotals.get(id) ?? { count: 0, total: 0 };
        aggregate.count += 1;
        aggregate.total += expense.amount;
        vehicleTotals.set(id, aggregate);
      }
      const byVehicle = vehicles.map((vehicle) => {
        const aggregate = vehicleTotals.get(String(vehicle._id)) ?? { count: 0, total: 0 };
        return {
          vehicleId: String(vehicle._id), label: `${vehicle.model} · ${vehicle.plate}`,
          count: aggregate.count, total: round2(aggregate.total),
        };
      }).sort((a, b) => b.total - a.total);
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
      const out = {
        year: year ?? null, chartYear, period: selectedPeriod, total, count: expenses.length,
        byGroup, byCategory, byMonth, byVehicle, people: balances,
        recentExpenses: [...expenses]
          .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || String(b._id).localeCompare(String(a._id)))
          .slice(0, 3)
          .map((item) => ({
            id: String(item._id), vehicleId: String(item.vehicleId._id ?? item.vehicleId),
            vehicleModel: item.vehicleId?.model ?? vehicleById.get(String(item.vehicleId))?.model ?? '',
            date: item.expenseDate, category: item.category, description: item.description,
            amount: item.amount, km: item.km, shared: item.shared,
            categoryLabel: EXPENSE_CATEGORIES.find((category) => category.key === item.category)?.label ?? item.category,
          })),
        currentKm: selectedVehicle?.currentKm ?? null,
        comparison: null,
        averageMonthly: null,
        costPerKm: null,
        consumptionKmPerLiter: null,
        possessionCostPercent: null,
        reminders: (await listVehicleReminders(userId, vehicleId))
          .filter((reminder) => ['overdue', 'upcoming'].includes(reminder.status))
          .slice(0, 3)
          .map(({ id, title, description, status, statusLabel, vehicleId: reminderVehicleId }) => ({
            id, title, description, status, statusLabel, vehicleId: reminderVehicleId,
          })),
      };
      const monthsWithExpenses = new Set(expenses.map((item) => item.expenseDate.slice(0, 7))).size;
      out.averageMonthly = expenses.length ? round2(total / monthsWithExpenses) : null;
      if (expenses.length) {
        const kms = expenses.map((item) => item.km).filter((km) => km != null);
        if (kms.length >= 2) {
          const kmSpan = Math.max(...kms) - Math.min(...kms);
          if (kmSpan > 0) {
            out.kmSpan = kmSpan;
            out.costPerKm = round2(total / kmSpan);
          }
        }

        const refuels = expenses
          .filter((item) => item.category === 'fuel' && item.liters > 0 && item.km != null)
          .sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || String(a._id).localeCompare(String(b._id)));
        let traveledKm = 0;
        let consumedLiters = 0;
        for (let index = 1; index < refuels.length; index += 1) {
          const distance = refuels[index].km - refuels[index - 1].km;
          if (distance > 0) {
            traveledKm += distance;
            consumedLiters += refuels[index].liters;
          }
        }
        if (consumedLiters > 0) out.consumptionKmPerLiter = round2(traveledKm / consumedLiters);
      }

      const acquisitionTotal = vehicles.reduce((sum, vehicle) => sum + (vehicle.purchaseValue || 0), 0);
      if (acquisitionTotal > 0) out.possessionCostPercent = round2((ownershipTotal / acquisitionTotal) * 100);

      const previousRange = selectedPeriod === 'month'
        ? (() => {
          const previousDate = new Date(Date.UTC(selectedYear, selectedMonth - 2, 1));
          return dateRange('month', previousDate.getUTCFullYear(), previousDate.getUTCMonth() + 1);
        })()
        : selectedPeriod === 'quarter'
          ? (() => {
            const firstMonth = Math.floor((selectedMonth - 1) / 3) * 3 - 1;
            const previousDate = new Date(Date.UTC(selectedYear, firstMonth, 1));
            return dateRange('quarter', previousDate.getUTCFullYear(), previousDate.getUTCMonth() + 1);
          })()
          : selectedPeriod === 'year'
            ? dateRange('year', selectedYear - 1, selectedMonth)
            : null;
      if (previousRange) {
        const previousExpenses = await VehicleExpense.find(filterExpenses(userId, { vehicleId, ...previousRange })).select('amount').lean();
        const previousTotal = round2(previousExpenses.reduce((sum, item) => sum + item.amount, 0));
        if (previousTotal > 0) {
          out.comparison = {
            total: previousTotal,
            percentChange: round2(((total - previousTotal) / previousTotal) * 100),
          };
        }
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
