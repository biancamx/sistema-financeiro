import mongoose from 'mongoose';
import { normalizeText } from './spreadsheet.reader.js';
import { Person } from '../../models/Person.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { Purchase } from '../../models/Purchase.js';
import { Installment } from '../../models/Installment.js';
import { BudgetSheet } from '../../models/BudgetSheet.js';
import { Birthday } from '../../models/Birthday.js';

const SECTION_MAP = {
  receitas: 'income', beneficios: 'benefits', investimentos: 'investments', descontos: 'deductions',
  alimentacao: 'food', veiculos: 'vehicle', despesas_variaveis: 'fixed', variadas: 'misc', moradia: 'housing',
};
const key = (value) => normalizeText(String(value ?? '').trim());

export async function executeSpreadsheetImport(userId, analyzedData, userDecisions = {}) {
  const summary = {
    peopleUpserted: 0, cardsUpserted: 0, purchasesUpserted: 0,
    installmentsUpserted: 0, budgetsUpserted: 0, birthdaysUpserted: 0,
  };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const personNames = new Set([
        ...(analyzedData.people ?? []),
        ...(analyzedData.purchasesGrouped ?? []).map((item) => item.personName),
        ...(analyzedData.monthlyBudgets ?? []).map((item) => item.person),
      ]);
      const people = new Map();
      for (const raw of personNames) {
        const name = String(raw ?? '').trim();
        if (!name) continue;
        let person = await Person.findOne({ userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).session(session);
        if (!person) {
          [person] = await Person.create([{ userId, name }], { session });
          summary.peopleUpserted++;
        }
        people.set(key(name), person._id);
      }
      const cardNames = new Set([
        ...(analyzedData.cards ?? []),
        ...(analyzedData.purchasesGrouped ?? []).map((item) => item.cardName),
      ]);
      const cards = new Map();
      for (const raw of cardNames) {
        const name = String(raw ?? '').trim();
        if (!name) continue;
        const limit = Number(analyzedData.limits?.[key(name)] ?? 0);
        let card = await Card.findOne({ userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).session(session);
        if (!card) {
          [card] = await Card.create([{ userId, name, limit, issuer: 'Outro', brand: 'outro' }], { session });
          summary.cardsUpserted++;
        } else if (limit > 0) {
          card.limit = limit;
          await card.save({ session });
        }
        cards.set(key(name), card._id);
      }
      const categories = new Map();
      for (const raw of analyzedData.categories ?? []) {
        const name = String(raw ?? '').trim();
        if (!name) continue;
        let category = await Category.findOne({ userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).session(session);
        if (!category) [category] = await Category.create([{ userId, name }], { session });
        categories.set(key(name), category._id);
      }
      if (userDecisions.replaceExisting) {
        const purchases = await Purchase.find({ userId, vehicleExpenseId: null }).select('_id').session(session);
        await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
        await Purchase.deleteMany({ userId, vehicleExpenseId: null }, { session });
      }
      for (const item of analyzedData.purchasesGrouped ?? []) {
        const personId = people.get(key(item.personName));
        const cardId = cards.get(key(item.cardName));
        if (!personId || !cardId) throw new Error(`Não foi possível localizar pessoa ou cartão da compra "${item.description}".`);
        let categoryId = item.category ? categories.get(key(item.category)) : null;
        if (item.category && !categoryId) {
          const name = String(item.category).trim();
          let category = await Category.findOne({ userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).session(session);
          if (!category) [category] = await Category.create([{ userId, name }], { session });
          categoryId = category._id;
        }
        const purchaseDate = /^\d{4}-\d{2}-\d{2}$/.test(item.purchaseDate || '') ? item.purchaseDate : null;
        const query = {
          userId, personId, cardId, categoryId: categoryId ?? null,
          description: item.description.trim(), totalAmount: item.totalAmount,
          totalInstallments: item.totalInstallments, purchaseDate,
        };
        let purchase = await Purchase.findOne(query).session(session);
        if (!purchase) {
          [purchase] = await Purchase.create([query], { session });
          summary.purchasesUpserted++;
        }
        const installments = [...item.installments].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
        for (const [index, installment] of installments.entries()) {
          const current = await Installment.findOne({
            userId, purchaseId: purchase._id, month: installment.month, year: installment.year,
          }).session(session);
          if (!current) {
            await Installment.create([{
              userId, purchaseId: purchase._id, number: index + 1, year: installment.year,
              month: installment.month, amount: installment.amount,
            }], { session });
            summary.installmentsUpserted++;
          } else if (current.paidAmount === 0) {
            current.number = index + 1;
            current.amount = installment.amount;
            await current.save({ session });
          }
        }
      }
      for (const item of analyzedData.monthlyBudgets ?? []) {
        const personId = people.get(key(item.person));
        if (!personId) throw new Error(`Pessoa não encontrada para a planilha "${item.person}".`);
        const section = SECTION_MAP[key(item.section)];
        if (!section) throw new Error(`Seção de planilha não reconhecida: "${item.section}".`);
        let sheet = await BudgetSheet.findOne({ userId, personId, year: item.year }).session(session);
        if (!sheet) [sheet] = await BudgetSheet.create([{ userId, personId, year: item.year }], { session });
        let row = sheet.rows.find((candidate) => candidate.section === section && key(candidate.label) === key(item.label));
        if (!row) {
          const position = Math.max(0, ...sheet.rows.map((candidate) => candidate.position)) + 1;
          sheet.rows.push({ section, label: item.label.trim(), position, cells: [] });
          row = sheet.rows[sheet.rows.length - 1];
        }
        for (const month of item.months) {
          const cell = row.cells.find((candidate) => candidate.month === month.month);
          if (month.amount === null) {
            if (cell) row.cells.splice(row.cells.indexOf(cell), 1);
          } else if (cell) cell.value = month.amount;
          else row.cells.push({ month: month.month, value: month.amount });
        }
        await sheet.save({ session });
        summary.budgetsUpserted++;
      }
      for (const item of analyzedData.birthdays ?? []) {
        const name = String(item.name).trim();
        const exists = await Birthday.exists({
          userId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
          day: item.day, month: item.month,
        }).session(session);
        if (!exists) {
          await Birthday.create([{ userId, name, day: item.day, month: item.month }], { session });
          summary.birthdaysUpserted++;
        }
      }
    });
  } finally {
    await session.endSession();
  }
  return summary;
}
