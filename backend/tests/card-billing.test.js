import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCardInstallments,
  getFirstStatementPeriod,
  getInvoiceDueDate,
} from '../src/lib/cardBilling.js';

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
