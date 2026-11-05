import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardBilling,
  ensureSubscriptionInstallmentsForPeriods,
  generateCardInstallments,
  getFirstStatementPeriod,
  getInvoiceDueDate,
  subscriptionActiveInPeriod,
} from '../src/lib/cardBilling.js';
import { Installment } from '../src/models/Installment.js';
import { Purchase } from '../src/models/Purchase.js';
import { Card } from '../src/models/Card.js';

const card = { closingDay: 22, dueDay: 5, closingDayEqual: 'next' };

test('compra antes ou depois do fechamento define a primeira fatura e o vencimento', () => {
  const beforeClose = generateCardInstallments({
    total: 100, count: 1, purchaseDate: '2026-10-20', card, startMonth: 10, startYear: 2026,
  });
  const afterClose = generateCardInstallments({
    total: 100, count: 1, purchaseDate: '2026-10-23', card, startMonth: 10, startYear: 2026,
  });

  assert.deepEqual([beforeClose[0].year, beforeClose[0].month], [2026, 10]);
  assert.equal(getInvoiceDueDate(card, beforeClose[0].year, beforeClose[0].month), '2026-11-05');
  assert.deepEqual([afterClose[0].year, afterClose[0].month], [2026, 11]);
  assert.equal(getInvoiceDueDate(card, afterClose[0].year, afterClose[0].month), '2026-12-05');
});

test('parcelas avançam mês a mês e a sobra de centavos fica na primeira parcela', () => {
  const installments = generateCardInstallments({
    total: 300, count: 3, purchaseDate: '2026-10-20', card, startMonth: 10, startYear: 2026,
  });
  assert.deepEqual(installments.map(({ year, month, amount }) => [year, month, amount]), [
    [2026, 10, 100], [2026, 11, 100], [2026, 12, 100],
  ]);

  const cents = generateCardInstallments({
    total: 100, count: 3, purchaseDate: '2026-10-20', card, startMonth: 10, startYear: 2026,
  });
  assert.deepEqual(cents.map((item) => item.amount), [33.34, 33.33, 33.33]);
  assert.equal(cents.reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 10000);
});

test('dia de fechamento é configurável com padrão na próxima fatura; vencimento respeita meses curtos', () => {
  assert.deepEqual(getFirstStatementPeriod('2026-10-22', card, { startMonth: 10, startYear: 2026 }), {
    year: 2026, month: 11,
  });
  assert.deepEqual(getFirstStatementPeriod('2026-10-22', { ...card, closingDayEqual: 'current' }, {
    startMonth: 10, startYear: 2026,
  }), { year: 2026, month: 10 });
  assert.equal(getInvoiceDueDate({ closingDay: 22, dueDay: 31 }, 2025, 2), '2025-02-28');
});

test('assinaturas canceladas permanecem na fatura do mês do cancelamento e param no mês seguinte', () => {
  const purchase = {
    isSubscription: true,
    subscriptionStatus: 'canceled',
    canceledAt: new Date('2026-11-04T12:00:00Z'),
  };
  assert.equal(subscriptionActiveInPeriod(purchase, 2026, 11), true);
  assert.equal(subscriptionActiveInPeriod(purchase, 2026, 10), true);
  assert.equal(subscriptionActiveInPeriod(purchase, 2026, 12), false);
  assert.equal(subscriptionActiveInPeriod({ ...purchase, subscriptionStatus: 'active' }, 2030, 1), true);
  assert.equal(subscriptionActiveInPeriod({ ...purchase, isSubscription: false }, 2026, 11), false);
});

test('assinaturas importadas respeitam o mês final informado no PDF', () => {
  const purchase = {
    isSubscription: true,
    subscriptionStatus: 'active',
    subscriptionEndAt: new Date('2026-12-31T12:00:00Z'),
  };
  assert.equal(subscriptionActiveInPeriod(purchase, 2026, 12), true);
  assert.equal(subscriptionActiveInPeriod(purchase, 2027, 1), false);
});

test('assinaturas sem histórico têm parcelas mensais geradas em lote', async () => {
  const originalFindPurchase = Purchase.find;
  const originalAggregateInstallment = Installment.aggregate;
  const originalFindInstallment = Installment.find;
  const originalCreateInstallment = Installment.create;
  let purchaseReads = 0;
  let aggregateReads = 0;
  let installmentReads = 0;
  try {
    Purchase.find = () => {
      purchaseReads += 1;
      return {
        populate: () => ({
          lean: async () => [{
            _id: '68eb3d5d8b2d9b9d4b0ec062',
            userId: '68eb3d5d8b2d9b9d4b0ec001',
            isSubscription: true,
            subscriptionStatus: 'active',
            cardId: { _id: '68eb3d5d8b2d9b9d4b0ec055', closingDay: 22, closingDayEqual: 'next' },
            totalAmount: 39.9,
          }],
        }),
      };
    };
    Installment.aggregate = async () => {
      aggregateReads += 1;
      return [];
    };
    Installment.find = () => ({
      lean: async () => {
        installmentReads += 1;
        return [];
      },
    });
    Installment.create = async (doc) => ({
      ...doc,
      _id: `installment-${doc.month}`,
      toObject() { return { ...this }; },
    });

    const periods = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, year: 2026 }));
    const created = await ensureSubscriptionInstallmentsForPeriods(
      '68eb3d5d8b2d9b9d4b0ec001',
      periods,
    );

    assert.equal(created.length, 12);
    assert.equal(created[0].number, 1);
    assert.equal(created[0].amount, 39.9);
    assert.deepEqual(created.map((item) => item.number), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(purchaseReads, 1);
    assert.equal(aggregateReads, 1);
    assert.equal(installmentReads, 1);
  } finally {
    Purchase.find = originalFindPurchase;
    Installment.aggregate = originalAggregateInstallment;
    Installment.find = originalFindInstallment;
    Installment.create = originalCreateInstallment;
  }
});

test('lista de cartões agrega fatura e limite com uma leitura em lote de parcelas', async () => {
  const originalCardFind = Card.find;
  const originalPurchaseFind = Purchase.find;
  const originalInstallmentFind = Installment.find;
  let purchaseReads = 0;
  let installmentReads = 0;
  const cardId = '68eb3d5d8b2d9b9d4b0ec055';
  const userId = '68eb3d5d8b2d9b9d4b0ec001';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  try {
    Card.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [{
            _id: cardId, name: 'Cartão teste', limit: 100, issuer: 'Outro', brand: 'Outro',
            lastDigits: null, color: '#000000', ownerId: null, dueDay: 10, closingDay: 3,
            closingDayEqual: 'next',
          }],
        }),
      }),
    });
    Purchase.find = (query) => {
      purchaseReads += 1;
      if (query.isSubscription) {
        return { populate: () => ({ lean: async () => [] }) };
      }
      return {
        select: () => ({
          lean: async () => [{
            _id: '68eb3d5d8b2d9b9d4b0ec062', cardId, isSubscription: false,
          }],
        }),
      };
    };
    Installment.find = () => ({
      lean: async () => {
        installmentReads += 1;
        return [
          { _id: 'past', purchaseId: '68eb3d5d8b2d9b9d4b0ec062', year: previousYear, month: previousMonth, amount: 90, paidAmount: 0, paid: false },
          { _id: 'current', purchaseId: '68eb3d5d8b2d9b9d4b0ec062', year, month, amount: 25.25, paidAmount: 5.05, paid: false },
          { _id: 'future', purchaseId: '68eb3d5d8b2d9b9d4b0ec062', year: nextYear, month: nextMonth, amount: 60.6, paidAmount: 0, paid: false },
        ];
      },
    });

    const cards = await createCardBilling().listCards(userId, month, year);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].invoice, 20.2);
    assert.equal(cards[0].used, 80.8);
    assert.equal(cards[0].available, 19.2);
    assert.equal(purchaseReads, 2);
    assert.equal(installmentReads, 1);
  } finally {
    Card.find = originalCardFind;
    Purchase.find = originalPurchaseFind;
    Installment.find = originalInstallmentFind;
  }
});
