import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectMongo } from '../src/db/mongo.js';
import { Birthday } from '../src/models/Birthday.js';
import { BudgetSheet } from '../src/models/BudgetSheet.js';
import { Card } from '../src/models/Card.js';
import { CashEntry } from '../src/models/CashEntry.js';
import { CashInstallment } from '../src/models/CashInstallment.js';
import { CashReceipt } from '../src/models/CashReceipt.js';
import { Category } from '../src/models/Category.js';
import { Installment } from '../src/models/Installment.js';
import { MonthStatus } from '../src/models/MonthStatus.js';
import { Person } from '../src/models/Person.js';
import { Purchase } from '../src/models/Purchase.js';
import { User } from '../src/models/User.js';
import { Vehicle } from '../src/models/Vehicle.js';
import { VehicleExpense } from '../src/models/VehicleExpense.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.resolve(here, '../src/db/seed-data.json'), 'utf8'));
const demoEmail = 'demo@local.dev';

function cellsFromValues(values = []) {
  return values.flatMap((value, index) => (
    Number.isFinite(Number(value)) && Number(value) !== 0
      ? [{ month: index + 1, value: Number(value) }]
      : []
  ));
}

async function seedDemoWorkspace(userId) {
  const models = [
    CashReceipt, CashInstallment, CashEntry, VehicleExpense, Vehicle, Birthday,
    BudgetSheet, MonthStatus, Installment, Purchase, Card, Category, Person,
  ];
  await Promise.all(models.map((model) => model.deleteMany({ userId })));

  const peopleNames = [...new Set([
    ...data.people,
    ...data.purchases.map((purchase) => purchase.person),
    ...data.budgets.map((budget) => budget.person),
    ...(data.fixed || []).map((budget) => budget.person),
  ])];
  const people = await Person.insertMany(peopleNames.map((name) => ({ userId, name })));
  const peopleByName = new Map(people.map((person) => [person.name, person._id]));

  const cardData = new Map(data.cards.map((card) => [card.name, card]));
  for (const purchase of data.purchases) {
    if (!cardData.has(purchase.card)) cardData.set(purchase.card, { name: purchase.card, limit: 0 });
  }
  const cards = await Card.insertMany([...cardData.values()].map((card) => ({
    userId,
    name: card.name,
    limit: Number(card.limit) || 0,
  })));
  const cardsByName = new Map(cards.map((card) => [card.name, card._id]));

  const categoryNames = [...new Set([
    ...data.categories,
    ...data.purchases.map((purchase) => purchase.category).filter(Boolean),
  ])];
  const categories = await Category.insertMany(categoryNames.map((name) => ({ userId, name })));
  const categoriesByName = new Map(categories.map((category) => [category.name, category._id]));

  const purchases = await Purchase.insertMany(data.purchases.map((purchase) => ({
    userId,
    personId: peopleByName.get(purchase.person),
    cardId: cardsByName.get(purchase.card),
    categoryId: purchase.category ? categoriesByName.get(purchase.category) ?? null : null,
    description: purchase.description,
    purchaseDate: purchase.date,
    totalAmount: Number(purchase.total),
    totalInstallments: Number(purchase.count) || 1,
  })));
  const installments = data.purchases.flatMap((purchase, index) => (
    (purchase.installments || []).map((installment) => ({
      userId,
      purchaseId: purchases[index]._id,
      number: installment.number,
      year: installment.year,
      month: installment.month,
      amount: Number(purchase.total) / (Number(purchase.count) || 1),
    }))
  ));
  if (installments.length) await Installment.insertMany(installments);

  const budgetRowsByPersonYear = new Map();
  const addBudgetRows = (budget, isFixed = false) => {
    const key = `${budget.person}:${budget.year}`;
    const rows = budgetRowsByPersonYear.get(key) || [];
    for (const row of budget.rows) {
      rows.push({
        section: isFixed ? 'fixed' : row.section,
        label: row.label,
        position: rows.length,
        receivableFrom: row.receivableFrom ?? null,
        obs: row.obs ?? null,
        cells: cellsFromValues(row.values),
      });
    }
    budgetRowsByPersonYear.set(key, rows);
  };
  for (const budget of data.budgets) addBudgetRows(budget);
  for (const budget of data.fixed || []) addBudgetRows(budget, true);

  const budgetSheets = [...budgetRowsByPersonYear].map(([key, rows]) => {
    const [personName, year] = key.split(':');
    return { userId, personId: peopleByName.get(personName), year: Number(year), rows };
  });
  if (budgetSheets.length) await BudgetSheet.insertMany(budgetSheets);

  const birthdays = (data.birthdays || []).map((birthday) => ({
    userId,
    personId: peopleByName.get(birthday.name) ?? null,
    name: birthday.name,
    day: birthday.day,
    month: birthday.month,
  }));
  if (birthdays.length) await Birthday.insertMany(birthdays);

  const statuses = (data.statuses || []).flatMap((status) => {
    const personId = peopleByName.get(status.person);
    return personId ? [{ userId, personId, year: status.year, month: status.month, status: status.status }] : [];
  });
  if (statuses.length) await MonthStatus.insertMany(statuses);

  const [personOneId, personTwoId] = ['Pessoa 01', 'Pessoa 02'].map((name) => peopleByName.get(name));
  if (personOneId && personTwoId) {
    const vehicles = await Vehicle.insertMany([
      { userId, kind: 'car', model: 'Carro de demonstração', plate: 'DEMO001', year: 2024, purchaseValue: 50000, ownerId: personOneId },
      { userId, kind: 'motorcycle', model: 'Motocicleta de demonstração', plate: 'DEMO002', year: 2024, purchaseValue: 12000, ownerId: personTwoId },
    ]);
    const date = (monthsAgo, day) => {
      const value = new Date();
      value.setDate(1);
      value.setMonth(value.getMonth() - monthsAgo);
      value.setDate(day);
      return value.toISOString().slice(0, 10);
    };
    const expenses = [];
    const addExpense = (vehicleId, monthsAgo, day, category, description, amount, km, payerId, shared) => {
      const expense = {
        userId,
        vehicleId,
        expenseDate: date(monthsAgo, day),
        category,
        description,
        amount,
        km,
        payerId,
        shared,
        splitMode: 'equal',
      };
      if (!shared) {
        expense.shares = [{ personId: payerId, amount }];
      } else {
        const cents = Math.round(amount * 100);
        expense.shares = [
          { personId: personOneId, amount: Math.ceil(cents / 2) / 100 },
          { personId: personTwoId, amount: Math.floor(cents / 2) / 100 },
        ];
      }
      expenses.push(expense);
    };

    const [car, motorcycle] = vehicles;
    addExpense(car._id, 5, 8, 'ipva', 'IPVA de demonstração', 800, null, personOneId, true);
    addExpense(car._id, 5, 15, 'insurance', 'Seguro de demonstração', 1200, null, personOneId, true);
    addExpense(car._id, 4, 3, 'oil', 'Óleo e filtro', 250, 12000, personTwoId, true);
    addExpense(car._id, 4, 20, 'fuel', 'Combustível', 180, 12500, personOneId, false);
    addExpense(car._id, 3, 12, 'tires', 'Pneus de demonstração', 600, 13000, personTwoId, true);
    addExpense(car._id, 3, 25, 'toll', 'Pedágio', 30, 13200, personOneId, false);
    addExpense(car._id, 2, 6, 'fuel', 'Combustível', 190, 13500, personTwoId, false);
    addExpense(car._id, 2, 18, 'wash', 'Lavagem', 50, 13600, personOneId, false);
    addExpense(car._id, 1, 9, 'fine', 'Multa de demonstração', 100, 14000, personOneId, false);
    addExpense(car._id, 1, 22, 'financing', 'Parcela de demonstração', 700, null, personTwoId, true);
    addExpense(car._id, 0, 2, 'fuel', 'Combustível', 200, 14500, personOneId, false);
    addExpense(motorcycle._id, 4, 10, 'licensing', 'Licenciamento', 80, null, personTwoId, false);
    addExpense(motorcycle._id, 3, 5, 'oil', 'Troca de óleo', 50, 8000, personTwoId, false);
    addExpense(motorcycle._id, 2, 14, 'corrective', 'Manutenção', 250, 8500, personTwoId, false);
    addExpense(motorcycle._id, 1, 3, 'fuel', 'Combustível', 45, 9000, personTwoId, false);
    addExpense(motorcycle._id, 0, 1, 'parking', 'Estacionamento', 15, 9200, personTwoId, false);
    await VehicleExpense.insertMany(expenses);
  }
}

async function main() {
  await connectMongo();
  const user = await User.findOneAndUpdate(
    { email: demoEmail },
    {
      $set: {
        name: 'Usuário Demo',
        passwordHash: 'local',
        provider: 'local',
        googleId: null,
        portalContactPersonId: null,
        reminderSettings: { enabled: true, triggerDay: 5, triggerHour: 9, autoSend: false },
      },
      $setOnInsert: { email: demoEmail },
    },
    { returnDocument: 'after', upsert: true, runValidators: true },
  );
  await seedDemoWorkspace(user._id);
  console.log(`Conta demo recriada no MongoDB (${demoEmail}).`);
}

try {
  await main();
} finally {
  await mongoose.disconnect();
}
