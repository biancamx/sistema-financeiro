import { badRequest, notFound } from './errors.js';
import { monthIndex, round2 } from './months.js';
import { outstandingInstallmentCentsSql } from './installments.js';

const toCents = (value) => Math.round(Number(value || 0) * 100);
const fromCents = (value) => value / 100;

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

export function createCardBilling(db) {
  function ownedCard(userId, cardId) {
    const card = db.prepare(
      `SELECT id, name, limit_amount AS "limit", due_day AS dueDay, closing_day AS closingDay,
              closing_day_equal AS closingDayEqual
       FROM cards WHERE id = ? AND user_id = ?`,
    ).get(cardId, userId);
    if (!card) throw notFound('Cartão não encontrado');
    return card;
  }

  function calculateInvoice(userId, cardId, month, year, personId = null) {
    const card = ownedCard(userId, cardId);
    const personFilter = personId === null ? '' : 'AND p.person_id = ?';
    const params = personId === null
      ? [userId, cardId, year, month]
      : [userId, cardId, year, month, personId];
    const cents = db.prepare(
      `SELECT COALESCE(SUM(${outstandingInstallmentCentsSql}), 0) AS cents
       FROM installments i JOIN purchases p ON p.id = i.purchase_id
       WHERE p.user_id = ? AND p.card_id = ? AND i.year = ? AND i.month = ? ${personFilter}`,
    ).get(...params).cents;
    return {
      cardId: card.id,
      month,
      year,
      amount: fromCents(cents),
      dueDate: getInvoiceDueDate(card, year, month),
    };
  }

  function calculatePersonInvoice(userId, personId, month, year) {
    const cents = db.prepare(
      `SELECT COALESCE(SUM(${outstandingInstallmentCentsSql}), 0) AS cents
       FROM installments i JOIN purchases p ON p.id = i.purchase_id
       WHERE p.user_id = ? AND p.person_id = ? AND i.year = ? AND i.month = ?`,
    ).get(userId, personId, year, month).cents;
    return fromCents(cents);
  }

  function calculatePersonInvoicesByYear(userId, personId, year) {
    return db.prepare(
      `SELECT c.id, c.name, i.month, SUM(${outstandingInstallmentCentsSql}) AS cents
       FROM installments i JOIN purchases p ON p.id = i.purchase_id
       JOIN cards c ON c.id = p.card_id
       WHERE p.user_id = ? AND p.person_id = ? AND i.year = ?
       GROUP BY c.id, i.month ORDER BY c.name COLLATE NOCASE`,
    ).all(userId, personId, year).map((row) => ({
      id: row.id,
      name: row.name,
      month: row.month,
      amount: fromCents(row.cents),
    }));
  }

  function calculateLimit(userId, cardId, referenceDate = new Date()) {
    const card = ownedCard(userId, cardId);
    const idx = monthIndex(referenceDate.getFullYear(), referenceDate.getMonth() + 1);
    const cents = db.prepare(
      `SELECT COALESCE(SUM(${outstandingInstallmentCentsSql}), 0) AS cents
       FROM installments i JOIN purchases p ON p.id = i.purchase_id
       WHERE p.user_id = ? AND p.card_id = ? AND (i.year * 12 + i.month) >= ?`,
    ).get(userId, cardId, idx).cents;
    const used = fromCents(cents);
    return {
      used,
      available: card.limit > 0 ? round2(card.limit - used) : 0,
      percentUsed: card.limit > 0 ? (used / card.limit) * 100 : 0,
    };
  }

  function listCards(userId, month, year, withImages = false) {
    const cards = db.prepare(
      `SELECT c.id, c.name, c.limit_amount AS "limit", c.issuer, c.brand, c.last_four AS lastFour,
              c.color, ${withImages ? 'c.image_data' : 'NULL'} AS imageData,
              c.owner_id AS ownerId, pe.name AS owner,
              c.due_day AS dueDay, c.closing_day AS closingDay, c.closing_day_equal AS closingDayEqual
       FROM cards c LEFT JOIN people pe ON pe.id = c.owner_id
       WHERE c.user_id = ? ORDER BY c.name COLLATE NOCASE`,
    ).all(userId);
    return cards.map((card) => ({
      ...card,
      invoice: calculateInvoice(userId, card.id, month, year).amount,
      invoiceDueDate: getInvoiceDueDate(card, year, month),
      ...calculateLimit(userId, card.id),
    }));
  }

  function recordPayment(userId, installmentId, paid) {
    const installment = db.prepare(
      'SELECT amount FROM installments WHERE id = ? AND user_id = ?',
    ).get(installmentId, userId);
    if (!installment) throw notFound('Parcela não encontrada');
    const paidAmount = paid ? installment.amount : 0;
    db.prepare('UPDATE installments SET paid = ?, paid_amount = ? WHERE id = ? AND user_id = ?')
      .run(paid ? 1 : 0, paidAmount, installmentId, userId);
    return { id: installmentId, paid };
  }

  function recordBulkPayment(userId, installmentIds, paid) {
    const placeholders = installmentIds.map(() => '?').join(', ');
    const result = db.transaction(() => {
      const count = db.prepare(
        `SELECT COUNT(*) AS count FROM installments WHERE user_id = ? AND id IN (${placeholders})`,
      ).get(userId, ...installmentIds).count;
      if (count !== installmentIds.length) throw notFound('Uma ou mais parcelas não foram encontradas');
      const statement = paid
        ? `UPDATE installments SET paid = 1, paid_amount = amount WHERE user_id = ? AND id IN (${placeholders})`
        : `UPDATE installments SET paid = 0, paid_amount = 0 WHERE user_id = ? AND id IN (${placeholders})`;
      return db.prepare(statement).run(userId, ...installmentIds).changes;
    })();
    return { updated: result };
  }

  function recordInvoicePayment(userId, cardId, month, year, amount) {
    const card = ownedCard(userId, cardId);
    const installments = db.prepare(
      `SELECT i.id, i.amount, i.paid_amount AS paidAmount
       FROM installments i JOIN purchases p ON p.id = i.purchase_id
       WHERE p.card_id = ? AND p.user_id = ? AND i.year = ? AND i.month = ?
         AND i.paid = 0 AND i.paid_amount < i.amount
       ORDER BY i.id`,
    ).all(cardId, userId, year, month);
    let remainingCents = toCents(amount);
    const invoiceCents = installments.reduce(
      (sum, item) => sum + Math.max(0, toCents(item.amount) - toCents(item.paidAmount)),
      0,
    );
    if (remainingCents > invoiceCents) throw badRequest('O pagamento não pode ser maior que o valor em aberto da fatura');
    const update = db.prepare('UPDATE installments SET paid_amount = ?, paid = ? WHERE id = ? AND user_id = ?');
    db.transaction(() => {
      for (const item of installments) {
        if (!remainingCents) break;
        const dueCents = Math.max(0, toCents(item.amount) - toCents(item.paidAmount));
        const paidCents = Math.min(dueCents, remainingCents);
        const paidAmount = fromCents(toCents(item.paidAmount) + paidCents);
        update.run(paidAmount, paidAmount >= item.amount - 0.005 ? 1 : 0, item.id, userId);
        remainingCents -= paidCents;
      }
    })();
    return { cardId: card.id, month, year, amount: fromCents(toCents(amount)) };
  }

  function rescheduleFutureUnpaid(userId, cardId, today = new Date()) {
    const card = ownedCard(userId, cardId);
    const purchases = db.prepare(
      `SELECT p.id, p.total, p.installments_count AS count, p.purchase_date AS purchaseDate,
              MIN(i.year * 12 + i.month) AS firstIndex
       FROM purchases p JOIN installments i ON i.purchase_id = p.id
       WHERE p.user_id = ? AND p.card_id = ?
       GROUP BY p.id`,
    ).all(userId, cardId);
    const currentIndex = monthIndex(today.getFullYear(), today.getMonth() + 1);
    const update = db.prepare(
      'UPDATE installments SET year = ?, month = ? WHERE id = ? AND paid = 0',
    );
    for (const purchase of purchases) {
      const fallbackIndex = purchase.firstIndex;
      const fallback = {
        startYear: Math.floor((fallbackIndex - 1) / 12),
        startMonth: ((fallbackIndex - 1) % 12) + 1,
      };
      const start = getFirstStatementPeriod(purchase.purchaseDate, card, fallback);
      const schedule = generateInstallments({
        count: purchase.count, total: purchase.total, startYear: start.year, startMonth: start.month,
      });
      const existing = db.prepare(
        'SELECT id, number, year, month FROM installments WHERE purchase_id = ?',
      ).all(purchase.id);
      for (const installment of existing) {
        const planned = schedule[installment.number - 1];
        const existingIndex = monthIndex(installment.year, installment.month);
        if (planned && existingIndex >= currentIndex) {
          update.run(planned.year, planned.month, installment.id);
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
    invoiceDueDate(cardId, userId, year, month) {
      return getInvoiceDueDate(ownedCard(userId, cardId), year, month);
    },
  };
}
