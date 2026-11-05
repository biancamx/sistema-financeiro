import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSubscriptionInstallments,
  generateCardInstallments,
  getFirstStatementPeriod,
  getInvoiceDueDate,
  subscriptionActiveInPeriod,
} from '../src/lib/cardBilling.js';
import { Installment } from '../src/models/Installment.js';
import { Purchase } from '../src/models/Purchase.js';

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

test('assinaturas ativas sem histórico de parcela surgem imediatamente no mês solicitado', async () => {
  const originalFindPurchase = Purchase.find;
  const originalFindOneInstallment = Installment.findOne;
  const originalCreateInstallment = Installment.create;
  try {
    Purchase.find = () => ({
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
    });
    Installment.findOne = (query) => ({
      sort: () => ({
        lean: async () => {
          if (query && query.purchaseId && query.number === 1) return null;
          return null;
        },
      }),
      lean: async () => {
        if (query && query.userId && query.subscriptionPeriod) return null;
        if (query && query.userId && query.purchaseId && query.year === 2026 && query.month === 11) return null;
        return null;
      },
    });
    Installment.create = async (doc) => ({ ...doc, _id: 'installment-1' });

    const created = await ensureSubscriptionInstallments(
      '68eb3d5d8b2d9b9d4b0ec001',
      11,
      2026,
    );

    assert.equal(created.length, 1);
    assert.equal(created[0].number, 1);
    assert.equal(created[0].year, 2026);
    assert.equal(created[0].month, 11);
    assert.equal(created[0].amount, 39.9);
  } finally {
    Purchase.find = originalFindPurchase;
    Installment.findOne = originalFindOneInstallment;
    Installment.create = originalCreateInstallment;
  }
});
