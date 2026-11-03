import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Person } from '../src/models/Person.js';
import { Card } from '../src/models/Card.js';
import { Purchase } from '../src/models/Purchase.js';
import { Installment } from '../src/models/Installment.js';
import { BudgetSheet } from '../src/models/BudgetSheet.js';
import { executeSpreadsheetImport } from '../src/modules/import/spreadsheet.writer.js';

test('spreadsheet import batches installments and saves budget sheets once per person and year', async (t) => {
  const originalMethods = {
    personFindOne: Person.findOne,
    cardFindOne: Card.findOne,
    purchaseFindOne: Purchase.findOne,
    installmentFind: Installment.find,
    installmentBulkWrite: Installment.bulkWrite,
    budgetFindOne: BudgetSheet.findOne,
    budgetSave: BudgetSheet.prototype.save,
  };
  t.after(() => {
    Person.findOne = originalMethods.personFindOne;
    Card.findOne = originalMethods.cardFindOne;
    Purchase.findOne = originalMethods.purchaseFindOne;
    Installment.find = originalMethods.installmentFind;
    Installment.bulkWrite = originalMethods.installmentBulkWrite;
    BudgetSheet.findOne = originalMethods.budgetFindOne;
    BudgetSheet.prototype.save = originalMethods.budgetSave;
  });

  const personId = new mongoose.Types.ObjectId();
  const cardId = new mongoose.Types.ObjectId();
  const purchaseId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  Person.findOne = async () => ({ _id: personId });
  Card.findOne = async () => ({ _id: cardId });
  Purchase.findOne = async () => ({ _id: purchaseId });
  Installment.find = () => ({
    select() { return this; },
    lean: async () => [],
  });
  const batchSizes = [];
  Installment.bulkWrite = async (operations) => {
    batchSizes.push(operations.length);
    return { upsertedCount: operations.length };
  };
  let budgetFindCount = 0;
  let budgetSaveCount = 0;
  let savedBudgetRows = [];
  BudgetSheet.findOne = async () => {
    budgetFindCount++;
    return null;
  };
  BudgetSheet.prototype.save = async function save() {
    budgetSaveCount++;
    savedBudgetRows = this.rows.map((row) => row.label);
    return this;
  };

  const summary = await executeSpreadsheetImport(userId, {
    people: ['Pessoa'],
    cards: ['Cartão'],
    purchasesGrouped: [{
      description: 'Compra teste',
      personName: 'Pessoa',
      cardName: 'Cartão',
      totalAmount: 501,
      totalInstallments: 501,
      installments: Array.from({ length: 501 }, (_, index) => ({
        month: 1,
        year: 2000 + index,
        amount: 1,
      })),
    }],
    monthlyBudgets: [
      { person: 'Pessoa', year: 2026, section: 'moradia', label: 'Aluguel', months: [] },
      { person: 'Pessoa', year: 2026, section: 'receitas', label: 'Salário', months: [] },
    ],
  });

  assert.deepEqual(batchSizes, [500, 1]);
  assert.equal(summary.installmentsUpserted, 501);
  assert.equal(budgetFindCount, 1);
  assert.equal(budgetSaveCount, 1);
  assert.deepEqual(savedBudgetRows, ['Aluguel', 'Salário']);
  assert.equal(summary.budgetsUpserted, 2);
});
