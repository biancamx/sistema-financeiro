import { badRequest, notFound } from './errors.js';
import { monthIndex, round2 } from './months.js';
import { Card } from '../models/Card.js';
import { Installment } from '../models/Installment.js';
import { Purchase } from '../models/Purchase.js';
import mongoose from 'mongoose';

const toCents = (value) => Math.round(Number(value || 0) * 100);
const fromCents = (value) => value / 100;

export function subscriptionActiveInPeriod(purchase, year, month) {
  if (!purchase.isSubscription) return false;
  if (purchase.subscriptionEndAt) {
    const endAt = new Date(purchase.subscriptionEndAt);
    if (!Number.isNaN(endAt.getTime())
      && monthIndex(year, month) > monthIndex(endAt.getUTCFullYear(), endAt.getUTCMonth() + 1)) return false;
  }
  if (purchase.subscriptionStatus !== 'canceled') return true;
  if (!purchase.canceledAt) return false;
  const canceledAt = new Date(purchase.canceledAt);
  if (Number.isNaN(canceledAt.getTime())) return false;
  return monthIndex(year, month) <= monthIndex(canceledAt.getUTCFullYear(), canceledAt.getUTCMonth() + 1);
}

export async function ensureSubscriptionInstallments(userId, month, year, filter = {}) {
  const purchases = await Purchase.find({ userId, isSubscription: true, ...filter })
    .populate('cardId', 'closingDay closingDayEqual')
    .lean();
  const requestedIndex = monthIndex(year, month);
  const created = [];

  for (const purchase of purchases) {
    if (!subscriptionActiveInPeriod(purchase, year, month) || !purchase.cardId) continue;
    const first = await Installment.findOne({ userId, purchaseId: purchase._id, number: 1 })
      .sort({ year: 1, month: 1 }).lean();
    const startIndex = first ? monthIndex(first.year, first.month) : requestedIndex;
    if (first && requestedIndex < startIndex) continue;

    const subscriptionPeriod = `${purchase._id}:${year}-${String(month).padStart(2, '0')}`;
    let installment = await Installment.findOne({ userId, subscriptionPeriod }).lean();
    if (!installment) {
      installment = await Installment.findOne({ userId, purchaseId: purchase._id, year, month }).lean();
      if (installment) {
        await Installment.updateOne(
          { _id: installment._id, userId },
          { $set: { subscriptionPeriod } },
        );
        installment.subscriptionPeriod = subscriptionPeriod;
      } else {
        try {
          installment = await Installment.create({
            userId,
            purchaseId: purchase._id,
            number: first ? requestedIndex - startIndex + 1 : 1,
            year,
            month,
            amount: purchase.totalAmount,
            paid: false,
            paidAmount: 0,
            subscriptionPeriod,
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
          installment = await Installment.findOne({ userId, subscriptionPeriod }).lean();
          if (!installment) throw error;
        }
      }
    }
    created.push(installment);
  }
  return created;
}

export function getInstallmentBalanceCents(amount, paidAmount, paid) {
  if (paid) return 0;
  return Math.max(0, toCents(amount) - Math.max(0, toCents(paidAmount)));
}

export function generateInstallments({ total, count, startYear, startMonth }) {
  const totalCents = toCents(total);
  const baseCents = Math.floor(totalCents / count);
  let remainder = totalCents - baseCents * count;
  const out = [];
  for (let number = 1; number <= count; number++) {
    const idx = startYear * 12 + (startMonth - 1) + number - 1;
    const cents = baseCents + (remainder > 0 ? 1 : 0);
    remainder -= cents - baseCents;
    out.push({
      number,
      year: Math.floor(idx / 12),
      month: (idx % 12) + 1,
      amount: fromCents(cents),
    });
  }
  return out;
}

export function splitWeighted(amount, weights, offset = 0) {
  const n = weights.length;
  const cents = BigInt(toCents(amount));
  const w = weights.map((value) => BigInt(value));
  const totalWeight = w.reduce((sum, value) => sum + value, 0n);
  const base = w.map((value) => (cents * value) / totalWeight);
  let remainder = Number(cents - base.reduce((sum, value) => sum + value, 0n));
  const order = w
    .map((value, i) => ({ i, frac: (cents * value) % totalWeight, tie: (i - (offset % n) + n) % n }))
    .sort((a, b) => (a.frac === b.frac ? a.tie - b.tie : a.frac > b.frac ? -1 : 1));
  const out = base.map(Number);
  for (const item of order) if (remainder-- > 0) out[item.i] += 1;
  return out.map(fromCents);
}

export function buildSharedInstallments(input, weights) {
  const list = Array.isArray(weights) ? weights : Array(weights).fill(1);
  return generateInstallments(input).map((installment, index) => ({
    ...installment,
    shares: splitWeighted(installment.amount, list, index),
  }));
}

function parsedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function getFirstStatementPeriod(purchaseDate, card, fallback) {
  const date = parsedDate(purchaseDate);
  if (!date) return { year: fallback.startYear, month: fallback.startMonth };
  const closingDay = card.closingDay || card.closing_day || 3;
  const equalDayPolicy = card.closingDayEqual || card.closing_day_equal || 'next';
  const nextMonth = date.day > closingDay || (date.day === closingDay && equalDayPolicy === 'next');
  const idx = date.year * 12 + date.month - 1 + (nextMonth ? 1 : 0);
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function generateCardInstallments({ total, count, purchaseDate, card, startYear, startMonth }) {
  const start = getFirstStatementPeriod(purchaseDate, card, { startYear, startMonth });
  return generateInstallments({ total, count, startYear: start.year, startMonth: start.month });
}

export function getInvoiceDueDate(card, year, month) {
  const closingDay = card.closingDay || card.closing_day || 3;
  const dueDay = card.dueDay || card.due_day || 10;
  const idx = year * 12 + month - 1 + (dueDay > closingDay ? 0 : 1);
  const dueYear = Math.floor(idx / 12);
  const dueMonth = (idx % 12) + 1;
  const day = Math.min(dueDay, new Date(Date.UTC(dueYear, dueMonth, 0)).getUTCDate());
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function createCardBilling() {
  function ownedCard(userId, cardId) {
    return Card.findOne({ _id: cardId, userId }).lean().then((card) => {
      if (!card) throw notFound('Cartão não encontrado');
      return {
        id: String(card._id), name: card.name, limit: card.limit,
        dueDay: card.dueDay, closingDay: card.closingDay, closingDayEqual: card.closingDayEqual,
      };
    });
  }

  async function invoiceCents(userId, cardId, month, year, personId = null) {
    await ensureSubscriptionInstallments(userId, month, year, {
      cardId,
      ...(personId === null ? {} : { personId }),
    });
    const purchases = await Purchase.find({
      userId, cardId, ...(personId === null ? {} : { personId }),
    }).select('_id isSubscription subscriptionStatus canceledAt subscriptionEndAt').lean();
    const installments = purchases.length ? await Installment.find({
      userId, purchaseId: { $in: purchases.map((purchase) => purchase._id) }, year, month,
    }).lean() : [];
    const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
    return installments.reduce((sum, item) => {
      const purchase = purchaseMap.get(String(item.purchaseId));
      if (purchase?.isSubscription && !subscriptionActiveInPeriod(purchase, year, month)) return sum;
      return sum + getInstallmentBalanceCents(item.amount, item.paidAmount, item.paid);
    }, 0);
  }

  async function calculateInvoice(userId, cardId, month, year, personId = null) {
    const card = await ownedCard(userId, cardId);
    const cents = await invoiceCents(userId, cardId, month, year, personId);
    return {
      cardId: card.id,
      month,
      year,
      amount: fromCents(cents),
      dueDate: getInvoiceDueDate(card, year, month),
    };
  }

  async function calculatePersonInvoice(userId, personId, month, year) {
    await ensureSubscriptionInstallments(userId, month, year, { personId });
    const purchases = await Purchase.find({ userId, personId }).select('_id isSubscription subscriptionStatus canceledAt subscriptionEndAt').lean();
    const installments = purchases.length ? await Installment.find({
      userId, purchaseId: { $in: purchases.map((purchase) => purchase._id) }, year, month,
    }).lean() : [];
    const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
    const cents = installments.reduce((sum, item) => {
      const purchase = purchaseMap.get(String(item.purchaseId));
      if (purchase?.isSubscription && !subscriptionActiveInPeriod(purchase, year, month)) return sum;
      return sum + getInstallmentBalanceCents(item.amount, item.paidAmount, item.paid);
    }, 0);
    return fromCents(cents);
  }

  async function calculatePersonInvoicesByYear(userId, personId, year) {
    for (let month = 1; month <= 12; month += 1) {
      await ensureSubscriptionInstallments(userId, month, year, { personId });
    }
    const purchases = await Purchase.find({ userId, personId })
      .select('isSubscription subscriptionStatus canceledAt subscriptionEndAt')
      .populate('cardId', 'name').lean();
    const installments = purchases.length ? await Installment.find({
      userId, purchaseId: { $in: purchases.map((purchase) => purchase._id) }, year,
    }).lean() : [];
    const byCardMonth = new Map();
    const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
    for (const installment of installments) {
      const purchase = purchaseMap.get(String(installment.purchaseId));
      if (!purchase?.cardId) continue;
      if (purchase.isSubscription && !subscriptionActiveInPeriod(purchase, year, installment.month)) continue;
      const key = `${purchase.cardId._id}:${installment.month}`;
      const item = byCardMonth.get(key) ?? { id: String(purchase.cardId._id), name: purchase.cardId.name, month: installment.month, cents: 0 };
      item.cents += getInstallmentBalanceCents(installment.amount, installment.paidAmount, installment.paid);
      byCardMonth.set(key, item);
    }
    return [...byCardMonth.values()].map(({ cents, ...row }) => ({ ...row, amount: fromCents(cents) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.month - b.month);
  }

  async function calculateLimit(userId, cardId, referenceDate = new Date()) {
    const card = await ownedCard(userId, cardId);
    const idx = monthIndex(referenceDate.getFullYear(), referenceDate.getMonth() + 1);
    await ensureSubscriptionInstallments(userId, referenceDate.getMonth() + 1, referenceDate.getFullYear(), { cardId });
    const purchases = await Purchase.find({ userId, cardId })
      .select('_id isSubscription subscriptionStatus canceledAt subscriptionEndAt').lean();
    const installments = purchases.length ? await Installment.find({
      userId, purchaseId: { $in: purchases.map((purchase) => purchase._id) },
    }).lean() : [];
    const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
    const nextSubscriptionPeriods = new Map();
    for (const item of installments) {
      const purchase = purchaseMap.get(String(item.purchaseId));
      const periodIndex = monthIndex(item.year, item.month);
      if (!purchase?.isSubscription || periodIndex < idx
        || !subscriptionActiveInPeriod(purchase, item.year, item.month)) continue;
      const previous = nextSubscriptionPeriods.get(String(item.purchaseId));
      if (!previous || periodIndex < monthIndex(previous.year, previous.month)) {
        nextSubscriptionPeriods.set(String(item.purchaseId), item);
      }
    }
    const cents = installments.reduce((sum, item) => {
      const purchase = purchaseMap.get(String(item.purchaseId));
      const periodIndex = monthIndex(item.year, item.month);
      if (purchase?.isSubscription) {
        const next = nextSubscriptionPeriods.get(String(item.purchaseId));
        if (next?._id.toString() !== item._id.toString()) return sum;
      } else if (periodIndex < idx) {
        return sum;
      }
      return sum + getInstallmentBalanceCents(item.amount, item.paidAmount, item.paid);
    }, 0);
    const used = fromCents(cents);
    return {
      used,
      available: card.limit > 0 ? round2(card.limit - used) : 0,
      percentUsed: card.limit > 0 ? (used / card.limit) * 100 : 0,
    };
  }

  async function listCards(userId, month, year, withImages = false) {
    const cards = await Card.find({ userId }).populate('ownerId', 'name').sort({ name: 1 }).lean();
    return Promise.all(cards.map(async (card) => {
      const shaped = {
        id: String(card._id), name: card.name, limit: card.limit, issuer: card.issuer, brand: card.brand,
        lastFour: card.lastDigits, color: card.color, imageData: withImages ? card.imageData : null,
        ownerId: card.ownerId ? String(card.ownerId._id) : null, owner: card.ownerId?.name ?? null,
        dueDay: card.dueDay, closingDay: card.closingDay, closingDayEqual: card.closingDayEqual,
      };
      const [invoice, limit] = await Promise.all([
        calculateInvoice(userId, card._id, month, year),
        calculateLimit(userId, card._id),
      ]);
      return { ...shaped, invoice: invoice.amount, invoiceDueDate: getInvoiceDueDate(shaped, year, month), ...limit };
    }));
  }

  async function recordPayment(userId, installmentId, paid) {
    const installment = await Installment.findOne({ _id: installmentId, userId }).lean();
    if (!installment) throw notFound('Parcela não encontrada');
    const paidAmount = paid ? installment.amount : 0;
    await Installment.updateOne({ _id: installmentId, userId }, { $set: { paid, paidAmount } });
    return { id: String(installmentId), paid };
  }

  async function recordBulkPayment(userId, installmentIds, paid) {
    const session = await mongoose.startSession();
    let updated;
    try {
      await session.withTransaction(async () => {
        const installments = await Installment.find({ userId, _id: { $in: installmentIds } }).session(session);
        if (installments.length !== new Set(installmentIds.map(String)).size) throw notFound('Uma ou mais parcelas não foram encontradas');
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
  }

  async function recordInvoicePayment(userId, cardId, month, year, amount) {
    const card = await ownedCard(userId, cardId);
    await ensureSubscriptionInstallments(userId, month, year, { cardId });
    const purchases = await Purchase.find({ userId, cardId })
      .select('_id isSubscription subscriptionStatus canceledAt subscriptionEndAt').lean();
    const installments = purchases.length ? await Installment.find({
      userId, purchaseId: { $in: purchases.map((purchase) => purchase._id) }, year, month,
      paid: false,
    }).sort({ _id: 1 }).lean() : [];
    const purchaseMap = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
    const chargeableInstallments = installments.filter((item) => {
      const purchase = purchaseMap.get(String(item.purchaseId));
      return !purchase?.isSubscription || subscriptionActiveInPeriod(purchase, year, month);
    });
    let remainingCents = toCents(amount);
    const invoiceCents = chargeableInstallments.reduce(
      (sum, item) => sum + Math.max(0, toCents(item.amount) - toCents(item.paidAmount)),
      0,
    );
    if (remainingCents > invoiceCents) throw badRequest('O pagamento não pode ser maior que o valor em aberto da fatura');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of chargeableInstallments) {
          if (!remainingCents) break;
          const dueCents = Math.max(0, toCents(item.amount) - toCents(item.paidAmount));
          const paidCents = Math.min(dueCents, remainingCents);
          const paidAmount = fromCents(toCents(item.paidAmount) + paidCents);
          await Installment.updateOne(
            { _id: item._id, userId },
            { $set: { paidAmount, paid: paidAmount >= item.amount - 0.005 } },
            { session },
          );
          remainingCents -= paidCents;
        }
      });
    } finally {
      await session.endSession();
    }
    return { cardId: card.id, month, year, amount: fromCents(toCents(amount)) };
  }

  async function rescheduleFutureUnpaid(userId, cardId, today = new Date(), session = null) {
    const card = await ownedCard(userId, cardId);
    const purchases = await Purchase.find({ userId, cardId }).session(session).lean();
    const currentIndex = monthIndex(today.getFullYear(), today.getMonth() + 1);
    for (const purchase of purchases) {
      if (purchase.isSubscription) continue;
      const existing = await Installment.find({ purchaseId: purchase._id }).session(session).sort({ number: 1 }).lean();
      if (!existing.length) continue;
      const fallbackIndex = Math.min(...existing.map((item) => monthIndex(item.year, item.month)));
      const fallback = {
        startYear: Math.floor(fallbackIndex / 12),
        startMonth: (fallbackIndex % 12) + 1,
      };
      const start = getFirstStatementPeriod(purchase.purchaseDate, card, fallback);
      const schedule = generateInstallments({
        count: purchase.totalInstallments, total: purchase.totalAmount, startYear: start.year, startMonth: start.month,
      });
      for (const installment of existing) {
        const planned = schedule[installment.number - 1];
        const existingIndex = monthIndex(installment.year, installment.month);
        if (planned && existingIndex >= currentIndex) {
          await Installment.updateOne(
            { _id: installment._id, paid: false },
            { $set: { year: planned.year, month: planned.month } },
            session ? { session } : {},
          );
        }
      }
    }
  }

  return {
    calculateInvoice,
    calculatePersonInvoice,
    calculatePersonInvoicesByYear,
    calculateLimit,
    listCards,
    recordPayment,
    recordBulkPayment,
    recordInvoicePayment,
    rescheduleFutureUnpaid,
    async invoiceDueDate(cardId, userId, year, month) {
      return getInvoiceDueDate(await ownedCard(userId, cardId), year, month);
    },
  };
}
