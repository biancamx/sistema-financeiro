import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPurchasesService } from '../src/modules/purchases/purchases.service.js';
import { Installment } from '../src/models/Installment.js';
import { Purchase } from '../src/models/Purchase.js';

test('lista compras e parcelas com uma consulta em lote para a página', async () => {
  const originalPurchaseFind = Purchase.find;
  const originalInstallmentFind = Installment.find;
  let purchaseReads = 0;
  let installmentReads = 0;
  const person = { _id: 'person-1', name: 'Pessoa teste' };
  const card = { _id: 'card-1', name: 'Cartão teste' };
  const purchases = ['purchase-1', 'purchase-2'].map((id, index) => ({
    _id: id,
    createdAt: null,
    updatedAt: null,
    description: `Compra ${index + 1}`,
    observation: '',
    purchaseDate: null,
    totalAmount: 100,
    totalInstallments: 1,
    isSubscription: false,
    subscriptionStatus: 'active',
    personId: person,
    cardId: card,
    categoryId: null,
    splitGroupId: null,
    vehicleExpenseId: null,
  }));
  try {
    Purchase.find = () => {
      purchaseReads += 1;
      const query = {
        populate() { return this; },
        sort() { return this; },
        lean: async () => purchases,
      };
      return query;
    };
    Installment.find = (filter) => {
      installmentReads += 1;
      assert.equal(filter.purchaseId.$in.length, 2);
      return {
        lean: async () => purchases.map((purchase, index) => ({
          _id: `installment-${index + 1}`,
          purchaseId: purchase._id,
          year: 2026,
          month: index + 1,
          number: 1,
          amount: 100,
          paid: index === 0,
          paidAmount: index === 0 ? 100 : 0,
        })),
      };
    };

    const result = await createPurchasesService().list('user-1', { page: 1, pageSize: 20 });
    assert.equal(result.total, 2);
    assert.deepEqual(result.data.map((item) => item.paidCount), [1, 0]);
    assert.equal(purchaseReads, 1);
    assert.equal(installmentReads, 1);
  } finally {
    Purchase.find = originalPurchaseFind;
    Installment.find = originalInstallmentFind;
  }
});
