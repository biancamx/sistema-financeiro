import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { monthIndex, round2 } from '../../lib/months.js';
import { buildSharedInstallments, createCardBilling, ensureSubscriptionInstallments, generateCardInstallments, generateInstallments, getFirstStatementPeriod, splitWeighted, subscriptionActiveInPeriod } from '../../lib/cardBilling.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { Installment } from '../../models/Installment.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';

export const buildSchedule = generateInstallments;
export { splitWeighted };
export const splitAmount = (amount, parts, offset = 0) => splitWeighted(amount, Array(parts).fill(1), offset);
export const buildSharedSchedule = buildSharedInstallments;

export function createPurchasesService() {
  const billing = createCardBilling();
  const cardFor = async (userId, cardId) => {
    const card = await Card.findOne({ _id: cardId, userId }).lean();
    if (!card) throw badRequest('Cartão inválido');
    return card;
  };
  const scheduleFor = async (userId, data) => generateCardInstallments({ ...data, card: await cardFor(userId, data.cardId) });
  const assertOwned = async (Model, id, userId, label) => {
    if (!await Model.exists({ _id: id, userId })) throw badRequest(`${label} inválido(a)`);
  };
  const ownedPurchase = async (userId, id) => {
    const purchase = await Purchase.findOne({ _id: id, userId }).lean();
    if (!purchase) throw notFound('Compra não encontrada');
    return purchase;
  };
  const listFor = (userId, query = {}) => {
    const filter = { userId };
    for (const field of ['personId', 'cardId', 'categoryId']) if (query[field]) filter[field] = query[field];
    if (query.search) filter.description = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    return filter;
  };
  const populatePurchases = (filter, sort = { _id: -1 }) => Purchase.find(filter)
    .populate('personId', 'name')
    .populate('cardId', 'name')
    .populate('categoryId', 'name')
    .sort(sort)
    .lean();
  const shape = (purchase, installments = [], groupRows = []) => {
    const first = installments.length ? installments.reduce((a, b) => (
      b.year * 12 + b.month < a.year * 12 + a.month ? b : a
    )) : null;
    const last = installments.length ? installments.reduce((a, b) => (
      b.year * 12 + b.month > a.year * 12 + a.month ? b : a
    )) : null;
    const total = purchase.totalAmount;
    const out = {
      id: String(purchase._id),
      createdAt: purchase.createdAt ?? null,
      updatedAt: purchase.updatedAt ?? null,
      description: purchase.description,
      observation: purchase.observation,
      purchaseDate: purchase.purchaseDate,
      total,
      count: purchase.totalInstallments,
      isSubscription: Boolean(purchase.isSubscription),
      subscriptionStatus: purchase.subscriptionStatus ?? 'active',
      canceledAt: purchase.canceledAt ?? null,
      subscriptionEndAt: purchase.subscriptionEndAt ?? null,
      personId: purchase.personId?._id ? String(purchase.personId._id) : String(purchase.personId),
      person: purchase.personId?.name ?? '',
      cardId: purchase.cardId?._id ? String(purchase.cardId._id) : String(purchase.cardId),
      card: purchase.cardId?.name ?? '',
      categoryId: purchase.categoryId?._id ? String(purchase.categoryId._id) : purchase.categoryId ? String(purchase.categoryId) : null,
      category: purchase.categoryId?.name ?? null,
      sharedGroup: purchase.splitGroupId,
      vehicleExpenseId: purchase.vehicleExpenseId ? String(purchase.vehicleExpenseId) : null,
      shared: Boolean(purchase.splitGroupId),
      perInstallment: round2(total / purchase.totalInstallments),
      first: first ? { year: first.year, month: first.month } : null,
      last: last ? { year: last.year, month: last.month } : null,
      scheduled: installments.length,
      paidCount: installments.filter((item) => item.paid).length,
    };
    if (purchase.splitGroupId) {
      const groupTotal = round2(groupRows.reduce((sum, item) => sum + item.totalAmount, 0));
      out.groupTotal = groupTotal;
      out.participants = groupRows.map((item) => item.personId?.name ?? '');
      out.participantsNames = out.participants.join(', ');
    }
    return out;
  };
  const createPurchase = async (userId, data, { splitGroupId = null, totalAmount = data.total, paidAmounts = new Map(), session } = {}) => {
    const [purchase] = await Purchase.create([{
      userId, description: data.description, observation: data.observation ?? '', purchaseDate: data.purchaseDate ?? null,
      categoryId: data.categoryId ?? null, personId: data.personId, cardId: data.cardId,
      totalAmount, totalInstallments: data.count, splitGroupId,
      isSubscription: Boolean(data.isSubscription),
    }], { session });
    const schedule = await scheduleFor(userId, { ...data, total: totalAmount });
    await Installment.insertMany(schedule.map((item) => {
      const paidAmount = Math.min(item.amount, paidAmounts.get(`${String(data.personId)}:${item.number}`) ?? 0);
      return {
        userId, purchaseId: purchase._id, number: item.number, year: item.year, month: item.month, amount: item.amount,
        paidAmount, paid: paidAmount >= item.amount - 0.005,
        ...(data.isSubscription && { subscriptionPeriod: `${purchase._id}:${item.year}-${String(item.month).padStart(2, '0')}` }),
      };
    }), { session });
    return purchase;
  };
  const installmentsFor = (purchaseId) => Installment.find({ purchaseId }).sort({ year: 1, month: 1, number: 1 }).lean();
  const get = async (userId, id) => {
    const purchase = await Purchase.findOne({ _id: id, userId })
      .populate('personId', 'name').populate('cardId', 'name').populate('categoryId', 'name').lean();
    if (!purchase) throw notFound('Compra não encontrada');
    const installments = await installmentsFor(purchase._id);
    return {
      ...shape(purchase, installments),
      installments: installments.map((item) => ({
        id: String(item._id), number: item.number, year: item.year, month: item.month, amount: item.amount,
        paidAmount: item.paidAmount, paid: item.paid,
      })),
    };
  };
  const getShared = async (userId, group) => {
    const rows = await populatePurchases({ userId, splitGroupId: group }, { _id: 1 });
    if (!rows.length) throw notFound('Compra compartilhada não encontrada');
    const allInstallments = await Installment.find({ userId, purchaseId: { $in: rows.map((row) => row._id) } })
      .sort({ number: 1, _id: 1 }).lean();
    const total = round2(rows.reduce((sum, row) => sum + row.totalAmount, 0));
    const byNumber = new Map();
    for (const item of allInstallments) {
      const key = item.number;
      const aggregate = byNumber.get(key) ?? { number: key, year: item.year, month: item.month, amount: 0, shares: [] };
      aggregate.amount = round2(aggregate.amount + item.amount);
      const purchase = rows.find((row) => String(row._id) === String(item.purchaseId));
      aggregate.shares.push({
        installmentId: String(item._id), personId: String(purchase.personId._id), amount: item.amount,
        paidAmount: item.paidAmount, paid: item.paid,
      });
      byNumber.set(key, aggregate);
    }
    const installments = [...byNumber.values()];
    const base = shape(rows[0], allInstallments, rows);
    const participantTotals = rows.map((row) => row.totalAmount);
    return {
      group, vehicleExpenseId: base.vehicleExpenseId, description: base.description, observation: base.observation,
      categoryId: base.categoryId, category: base.category, cardId: base.cardId, card: base.card,
      purchaseDate: base.purchaseDate, total, count: base.count,
      perInstallment: installments[0]?.amount ?? round2(total / base.count), first: base.first, last: base.last,
      splitMode: Math.max(...participantTotals) - Math.min(...participantTotals) <= 0.03 ? 'equal' : 'amount',
      participants: rows.map((row) => ({
        personId: String(row.personId._id), person: row.personId.name, purchaseId: String(row._id),
        total: row.totalAmount, percent: round2(row.totalAmount / total * 100),
        paidCount: allInstallments.filter((item) => String(item.purchaseId) === String(row._id) && item.paid).length,
      })),
      installments,
    };
  };

  return {
    async listInstallments(userId, query) {
      await ensureSubscriptionInstallments(userId, query.month, query.year);
      const filter = listFor(userId, query);
      const purchases = await populatePurchases(filter, { _id: 1 });
      const purchaseById = new Map(purchases.map((p) => [String(p._id), p]));
      const installments = purchases.length ? await Installment.find({
        userId, purchaseId: { $in: purchases.map((p) => p._id) }, year: query.year, month: query.month,
      }).sort({ number: 1 }).lean() : [];
      const data = installments.filter((item) => {
        const purchase = purchaseById.get(String(item.purchaseId));
        return !purchase?.isSubscription || subscriptionActiveInPeriod(purchase, query.year, query.month);
      }).map((item) => {
        const p = purchaseById.get(String(item.purchaseId));
        return {
          id: String(item._id), purchaseId: String(p._id), number: item.number, count: p.totalInstallments,
          isSubscription: Boolean(p.isSubscription),
          purchaseCreatedAt: p.createdAt ?? null, updatedAt: item.updatedAt ?? null,
          purchaseDate: p.purchaseDate,
          purchaseTotal: p.splitGroupId
            ? round2(purchases.filter((other) => other.splitGroupId === p.splitGroupId).reduce((sum, other) => sum + other.totalAmount, 0))
            : p.totalAmount,
          amount: item.amount, paidAmount: item.paidAmount, paid: item.paid, description: p.description,
          person: p.personId?.name ?? '', card: p.cardId?.name ?? '', category: p.categoryId?.name ?? null,
          sharedGroup: p.splitGroupId, vehicleExpenseId: p.vehicleExpenseId ? String(p.vehicleExpenseId) : null,
          sharedWith: p.splitGroupId
            ? purchases.filter((other) => other.splitGroupId === p.splitGroupId && String(other._id) !== String(p._id))
              .map((other) => other.personId?.name).filter(Boolean).join(', ')
            : null,
        };
      });
      return { data, total: round2(data.reduce((sum, item) => sum + item.amount, 0)) };
    },
    async listSubscriptions(userId, query = {}) {
      const all = await populatePurchases({ userId, isSubscription: true });
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const active = all.filter((purchase) => purchase.subscriptionStatus !== 'canceled'
        && (!purchase.subscriptionEndAt
          || monthIndex(currentYear, currentMonth) <= monthIndex(
            new Date(purchase.subscriptionEndAt).getUTCFullYear(),
            new Date(purchase.subscriptionEndAt).getUTCMonth() + 1,
          )));
      const activeIds = new Set(active.map((purchase) => String(purchase._id)));
      const filtered = all.filter((purchase) => {
        const isActive = activeIds.has(String(purchase._id));
        return (!query.status || query.status === (isActive ? 'active' : 'canceled'))
          && (!query.personId || String(purchase.personId?._id) === String(query.personId))
          && (!query.cardId || String(purchase.cardId?._id) === String(query.cardId))
          && (!query.categoryId || String(purchase.categoryId?._id) === String(query.categoryId))
          && (!query.search || purchase.description.toLocaleLowerCase().includes(query.search.toLocaleLowerCase()));
      });
      const data = filtered.map((purchase) => ({
        id: String(purchase._id),
        description: purchase.description,
        amount: purchase.totalAmount,
        person: purchase.personId?.name ?? '',
        card: purchase.cardId?.name ?? '',
        subscriptionStatus: activeIds.has(String(purchase._id)) ? 'active' : 'canceled',
        canceledAt: purchase.canceledAt ?? purchase.subscriptionEndAt ?? null,
        createdAt: purchase.createdAt ?? null,
      }));
      return {
        data,
        activeCount: active.length,
        canceledCount: all.length - active.length,
        activeMonthlyTotal: round2(active.reduce((sum, purchase) => sum + purchase.totalAmount, 0)),
      };
    },
    async list(userId, query) {
      const filter = listFor(userId, query);
      const purchases = await populatePurchases(filter);
      const collapse = !query.personId;
      const seenGroups = new Set();
      const unique = collapse ? purchases.filter((purchase) => {
        if (!purchase.splitGroupId) return true;
        if (seenGroups.has(purchase.splitGroupId)) return false;
        seenGroups.add(purchase.splitGroupId);
        return true;
      }) : purchases;
      const total = unique.length;
      const page = unique.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      const pageIds = page.map((purchase) => purchase._id);
      const installments = pageIds.length
        ? await Installment.find({ userId, purchaseId: { $in: pageIds } }).lean()
        : [];
      const installmentsByPurchase = new Map();
      for (const installment of installments) {
        const key = String(installment.purchaseId);
        const rows = installmentsByPurchase.get(key) ?? [];
        rows.push(installment);
        installmentsByPurchase.set(key, rows);
      }
      const groupRowsById = new Map();
      for (const purchase of purchases) {
        if (!purchase.splitGroupId) continue;
        const rows = groupRowsById.get(purchase.splitGroupId) ?? [];
        rows.push(purchase);
        groupRowsById.set(purchase.splitGroupId, rows);
      }
      const data = page.map((purchase) => {
        const rows = installmentsByPurchase.get(String(purchase._id)) ?? [];
        const groupRows = groupRowsById.get(purchase.splitGroupId) ?? [];
        const result = shape(purchase, rows, groupRows);
        if (collapse && purchase.splitGroupId) {
          result.total = result.groupTotal;
          result.perInstallment = round2(result.groupTotal / purchase.totalInstallments);
          result.person = result.participantsNames;
          result.personId = null;
        }
        return result;
      });
      return { data, page: query.page, pageSize: query.pageSize, total };
    },
    get,
    async create(userId, data) {
      await assertOwned(Person, data.personId, userId, 'Pessoa');
      await assertOwned(Card, data.cardId, userId, 'Cartão');
      if (data.categoryId) await assertOwned(Category, data.categoryId, userId, 'Categoria');
      const session = await mongoose.startSession();
      let id;
      try {
        await session.withTransaction(async () => {
          const purchase = await createPurchase(userId, data, { session });
          id = purchase._id;
        });
      } finally { await session.endSession(); }
      return get(userId, id);
    },
    async update(userId, id, data) {
      const current = await Purchase.findOne({ _id: id, userId }).lean();
      if (!current) throw notFound('Compra não encontrada');
      if (current.splitGroupId) throw badRequest('Esta compra é compartilhada: edite ou exclua pela compra compartilhada (todos os participantes de uma vez).');
      if (current.vehicleExpenseId) throw conflict('Este lançamento foi criado na Gestão de Veículos. Edite ou exclua pela aba Gestão de Veículos para evitar duplicidade.');
      await assertOwned(Person, data.personId, userId, 'Pessoa');
      const card = await cardFor(userId, data.cardId);
      if (data.categoryId) await assertOwned(Category, data.categoryId, userId, 'Categoria');
      const oldInstallments = await installmentsFor(id);
      const first = oldInstallments.sort((a, b) => a.number - b.number)[0];
      const period = getFirstStatementPeriod(data.purchaseDate, card, { startYear: data.startYear, startMonth: data.startMonth });
      const scheduleChanged = current.totalAmount !== data.total || current.totalInstallments !== data.count
        || String(current.cardId) !== String(data.cardId) || current.purchaseDate !== (data.purchaseDate ?? null)
        || first?.year !== period.year || first?.month !== period.month
        || Boolean(current.isSubscription) !== Boolean(data.isSubscription);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Purchase.updateOne({ _id: id, userId }, {
            $set: {
              description: data.description, categoryId: data.categoryId ?? null, personId: data.personId,
              cardId: data.cardId, purchaseDate: data.purchaseDate ?? null, totalAmount: data.total,
              totalInstallments: data.count, observation: data.observation ?? current.observation ?? '',
              isSubscription: Boolean(data.isSubscription),
              subscriptionStatus: data.isSubscription
                ? (current.isSubscription ? current.subscriptionStatus : 'active')
                : 'active',
              canceledAt: data.isSubscription && current.isSubscription ? current.canceledAt : null,
              subscriptionEndAt: data.isSubscription && current.isSubscription ? current.subscriptionEndAt : null,
            },
          }, { session });
          if (scheduleChanged) {
            const paid = new Map(oldInstallments.map((item) => [item.number, item.paidAmount]));
            await Installment.deleteMany({ purchaseId: id, userId }, { session });
            const schedule = await scheduleFor(userId, data);
            await Installment.insertMany(schedule.map((item) => {
              const paidAmount = Math.min(item.amount, paid.get(item.number) ?? 0);
              return {
                userId, purchaseId: id, number: item.number, year: item.year, month: item.month,
                amount: item.amount, paidAmount, paid: paidAmount >= item.amount - 0.005,
                ...(data.isSubscription && { subscriptionPeriod: `${id}:${item.year}-${String(item.month).padStart(2, '0')}` }),
              };
            }), { session });
          }
        });
      } finally { await session.endSession(); }
      return get(userId, id);
    },
    async setSubscriptionStatus(userId, id, status) {
      const purchase = await Purchase.findOne({ _id: id, userId });
      if (!purchase) throw notFound('Compra não encontrada');
      if (!purchase.isSubscription) throw badRequest('Esta compra não é uma assinatura');
      if (status === 'canceled' && purchase.subscriptionStatus !== 'canceled') {
        purchase.subscriptionStatus = 'canceled';
        purchase.canceledAt = new Date();
        await purchase.save();
        const canceledPeriod = purchase.canceledAt.getFullYear() * 12 + purchase.canceledAt.getMonth() + 1;
        await Installment.deleteMany({
          userId,
          purchaseId: purchase._id,
          $expr: { $gt: [{ $add: [{ $multiply: ['$year', 12] }, '$month'] }, canceledPeriod] },
        });
      } else if (status === 'active') {
        purchase.subscriptionStatus = 'active';
        purchase.canceledAt = null;
        purchase.subscriptionEndAt = null;
        await purchase.save();
      }
      return {
        id: String(purchase._id),
        subscriptionStatus: purchase.subscriptionStatus,
        canceledAt: purchase.canceledAt,
      };
    },
    async remove(userId, id) {
      const purchase = await Purchase.findOne({ _id: id, userId });
      if (!purchase) throw notFound('Compra não encontrada');
      if (purchase.splitGroupId) throw badRequest('Esta compra é compartilhada: edite ou exclua pela compra compartilhada (todos os participantes de uma vez).');
      if (purchase.vehicleExpenseId) throw conflict('Este lançamento foi criado na Gestão de Veículos. Edite ou exclua pela aba Gestão de Veículos para evitar duplicidade.');
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Installment.deleteMany({ userId, purchaseId: id }, { session });
          await purchase.deleteOne({ session });
        });
      } finally { await session.endSession(); }
    },
    async updateObservation(userId, id, observation) {
      const purchase = await Purchase.findOne({ _id: id, userId });
      if (!purchase) throw notFound('Compra não encontrada');
      if (purchase.splitGroupId) {
        await Purchase.updateMany({ userId, splitGroupId: purchase.splitGroupId }, { $set: { observation } });
      } else purchase.observation = observation, await purchase.save();
      return { id: String(id), observation };
    },
    _checkShared(userId, data) {
      return (async () => {
        const list = data.participants;
        if (list.length < 2) throw badRequest('Escolha pelo menos 2 participantes');
        for (const participant of list) await assertOwned(Person, participant.personId, userId, 'Pessoa');
        await assertOwned(Card, data.cardId, userId, 'Cartão');
        if (data.categoryId) await assertOwned(Category, data.categoryId, userId, 'Categoria');
        let weights;
        if (data.splitMode === 'percent') {
          weights = list.map((p) => Math.round((p.value ?? 0) * 100));
          if (Math.abs(weights.reduce((a, b) => a + b, 0) - 10000) > 1) throw badRequest('A soma das porcentagens deve ser 100%');
        } else if (data.splitMode === 'amount') {
          weights = list.map((p) => Math.round((p.value ?? 0) * 100));
          if (Math.abs(weights.reduce((a, b) => a + b, 0) - Math.round(data.total * 100)) > 1) throw badRequest('A soma dos valores de cada pessoa deve ser igual ao total da compra');
        } else weights = list.map(() => 1);
        if (weights.some((w) => !(w > 0))) throw badRequest('Cada participante precisa ter uma parte maior que zero');
        return list.map((p, i) => ({ personId: p.personId, weight: weights[i] }));
      })();
    },
    async createShared(userId, data) {
      const parts = await this._checkShared(userId, data);
      const schedule = (await scheduleFor(userId, data)).map((item, index) => ({
        ...item, shares: splitWeighted(item.amount, parts.map((part) => part.weight), index),
      }));
      if (schedule.some((item) => item.shares.some((share) => share <= 0))) throw badRequest('Valor pequeno demais para dividir desse jeito entre as pessoas e parcelas');
      const group = randomUUID();
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          for (let i = 0; i < parts.length; i++) {
            const mine = schedule.map((item) => item.shares[i]);
            const total = round2(mine.reduce((sum, amount) => sum + amount, 0));
            const [purchase] = await Purchase.create([{
              userId, description: data.description, observation: data.observation ?? '',
              purchaseDate: data.purchaseDate ?? null, categoryId: data.categoryId ?? null,
              personId: parts[i].personId, cardId: data.cardId, totalAmount: total,
              totalInstallments: data.count, splitGroupId: group,
            }], { session });
            await Installment.insertMany(schedule.map((item, index) => ({
              userId, purchaseId: purchase._id, number: item.number, year: item.year, month: item.month,
              amount: item.shares[i], paid: false, paidAmount: 0,
            })), { session });
          }
        });
      } finally { await session.endSession(); }
      return getShared(userId, group);
    },
    getShared,
    async updateShared(userId, group, data) {
      const current = await getShared(userId, group);
      if (current.vehicleExpenseId) throw conflict('Este lançamento foi criado na Gestão de Veículos. Edite ou exclua pela aba Gestão de Veículos para evitar duplicidade.');
      const parts = await this._checkShared(userId, data);
      const paidAmounts = new Map(current.installments.flatMap((item) => item.shares.map((share) => [`${share.personId}:${item.number}`, share.paidAmount])));
      const schedule = (await scheduleFor(userId, data)).map((item, index) => ({
        ...item, shares: splitWeighted(item.amount, parts.map((part) => part.weight), index),
      }));
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const oldPurchases = await Purchase.find({ userId, splitGroupId: group }).select('_id').session(session);
          await Installment.deleteMany({ userId, purchaseId: { $in: oldPurchases.map((p) => p._id) } }, { session });
          await Purchase.deleteMany({ userId, splitGroupId: group }, { session });
          for (let i = 0; i < parts.length; i++) {
            const total = round2(schedule.reduce((sum, item) => sum + item.shares[i], 0));
            const [purchase] = await Purchase.create([{
              userId, description: data.description, observation: data.observation ?? '',
              purchaseDate: data.purchaseDate ?? null, categoryId: data.categoryId ?? null,
              personId: parts[i].personId, cardId: data.cardId, totalAmount: total,
              totalInstallments: data.count, splitGroupId: group,
            }], { session });
            await Installment.insertMany(schedule.map((item) => {
              const amount = item.shares[i];
              const paidAmount = Math.min(amount, paidAmounts.get(`${parts[i].personId}:${item.number}`) ?? 0);
              return {
                userId, purchaseId: purchase._id, number: item.number, year: item.year, month: item.month,
                amount, paidAmount, paid: paidAmount >= amount - 0.005,
              };
            }), { session });
          }
        });
      } finally { await session.endSession(); }
      return getShared(userId, group);
    },
    async removeShared(userId, group) {
      const rows = await Purchase.find({ userId, splitGroupId: group });
      if (!rows.length) throw notFound('Compra compartilhada não encontrada');
      if (rows.some((p) => p.vehicleExpenseId)) throw conflict('Este lançamento foi criado na Gestão de Veículos. Edite ou exclua pela aba Gestão de Veículos para evitar duplicidade.');
      const ids = rows.map((p) => p._id);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Installment.deleteMany({ userId, purchaseId: { $in: ids } }, { session });
          await Purchase.deleteMany({ userId, splitGroupId: group }, { session });
        });
      } finally { await session.endSession(); }
    },
    setPaid: (userId, id, paid) => billing.recordPayment(userId, id, paid),
    setManyPaid: (userId, ids, paid = true) => billing.recordBulkPayment(userId, ids, paid),
    async setMonthPaid(userId, personId, month, year, paid) {
      await assertOwned(Person, personId, userId, 'Pessoa');
      const purchases = await Purchase.find({ userId, personId, cardId: { $ne: null } }).select('_id').lean();
      const purchaseIds = purchases.map((purchase) => purchase._id);
      if (!purchaseIds.length) return { updated: 0 };

      const session = await mongoose.startSession();
      let updated = 0;
      try {
        await session.withTransaction(async () => {
          const installments = await Installment.find({
            userId, purchaseId: { $in: purchaseIds }, month, year,
          }).session(session);
          for (const installment of installments) {
            installment.paid = paid;
            installment.paidAmount = paid ? installment.amount : 0;
            await installment.save({ session });
          }
          updated = installments.length;
        });
      } finally {
        await session.endSession();
      }
      return { updated };
    },
    async exportCsv(userId) {
      const purchases = await populatePurchases({ userId }, { _id: 1 });
      const ids = purchases.map((p) => p._id);
      const installments = ids.length ? await Installment.find({ userId, purchaseId: { $in: ids } }).sort({ year: 1, month: 1 }).lean() : [];
      const byId = new Map(purchases.map((p) => [String(p._id), p]));
      const esc = (value) => {
        let s = value == null ? '' : String(value);
        if (/^[=+\-@]/.test(s)) s = `'${s}`;
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = ['Data da compra', 'Descrição', 'Categoria', 'Pessoa', 'Cartão', 'Valor total', 'Qtd. parcelas', 'Parcela nº', 'Mês', 'Ano', 'Valor da parcela', 'Paga'];
      const lines = installments.map((item) => {
        const p = byId.get(String(item.purchaseId));
        return [p.purchaseDate, p.description, p.categoryId?.name, p.personId?.name, p.cardId?.name, p.totalAmount, p.totalInstallments, item.number, item.month, item.year, item.amount, item.paid ? 'sim' : 'não'];
      });
      return [head, ...lines].map((line) => line.map(esc).join(';')).join('\n');
    },
  };
}
