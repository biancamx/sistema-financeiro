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

function toSafeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asUniqueName(value) {
  return toSafeText(value, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function executeSpreadsheetImport(userId, analyzedData, userDecisions = {}) {
  const payload = analyzedData && typeof analyzedData === 'object' ? analyzedData : {};
  const summary = {
    peopleUpserted: 0, cardsUpserted: 0, purchasesUpserted: 0,
    installmentsUpserted: 0, budgetsUpserted: 0, birthdaysUpserted: 0,
  };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const personNames = new Set([
        ...(Array.isArray(payload.people) ? payload.people : []),
        ...(Array.isArray(payload.purchasesGrouped) ? payload.purchasesGrouped : []).map((item) => item?.personName),
        ...(Array.isArray(payload.monthlyBudgets) ? payload.monthlyBudgets : []).map((item) => item?.person),
      ]);
      const people = new Map();
      for (const raw of personNames) {
        const name = toSafeText(raw);
        if (!name) continue;
        const safeName = asUniqueName(name);
        let person = await Person.findOne({ userId, name: new RegExp(`^${safeName}$`, 'i') }).session(session);
        if (!person) {
          [person] = await Person.create([{ userId, name }], { session });
          summary.peopleUpserted++;
        }
        people.set(key(name), person._id);
      }
      const cardNames = new Set([
        ...(Array.isArray(payload.cards) ? payload.cards : []),
        ...(Array.isArray(payload.purchasesGrouped) ? payload.purchasesGrouped : []).map((item) => item?.cardName),
      ]);
      const cards = new Map();
      for (const raw of cardNames) {
        const name = toSafeText(raw);
        if (!name) continue;
        const limit = toSafeNumber(payload.limits?.[key(name)], 0);
        const safeName = asUniqueName(name);
        let card = await Card.findOne({ userId, name: new RegExp(`^${safeName}$`, 'i') }).session(session);
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
      for (const raw of Array.isArray(payload.categories) ? payload.categories : []) {
        const name = toSafeText(raw);
        if (!name) continue;
        const safeName = asUniqueName(name);
        let category = await Category.findOne({ userId, name: new RegExp(`^${safeName}$`, 'i') }).session(session);
        if (!category) [category] = await Category.create([{ userId, name }], { session });
        categories.set(key(name), category._id);
      }
      if (userDecisions?.replaceExisting) {
        const purchases = await Purchase.find({ userId, vehicleExpenseId: null }).select('_id').session(session);
        await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
        await Purchase.deleteMany({ userId, vehicleExpenseId: null }, { session });
      }
      for (const item of Array.isArray(payload.purchasesGrouped) ? payload.purchasesGrouped : []) {
        if (!item || typeof item !== 'object') continue;
        const description = toSafeText(item.description, 'Compra importada');
        const personName = toSafeText(item.personName);
        const cardName = toSafeText(item.cardName);
        const personId = people.get(key(personName));
        const cardId = cards.get(key(cardName));
        if (!personId || !cardId) {
          throw new Error(`Não foi possível localizar pessoa ou cartão da compra "${description}".`);
        }
        let categoryId = item.category ? categories.get(key(item.category)) : null;
        if (item.category && !categoryId) {
          const name = toSafeText(item.category);
          const safeName = asUniqueName(name);
          let category = await Category.findOne({ userId, name: new RegExp(`^${safeName}$`, 'i') }).session(session);
          if (!category) [category] = await Category.create([{ userId, name }], { session });
          categoryId = category._id;
        }
        const purchaseDate = /^\d{4}-\d{2}-\d{2}$/.test(toSafeText(item.purchaseDate)) ? toSafeText(item.purchaseDate) : null;
        const totalInstallments = Math.max(1, Number(item.totalInstallments) || 1);
        const totalAmount = toSafeNumber(item.totalAmount, 0);
        const query = {
          userId, personId, cardId, categoryId: categoryId ?? null,
          description, totalAmount, totalInstallments, purchaseDate,
        };
        let purchase = await Purchase.findOne(query).session(session);
        if (!purchase) {
          [purchase] = await Purchase.create([query], { session });
          summary.purchasesUpserted++;
        }
        const installments = Array.isArray(item.installments) ? [...item.installments].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)) : [];
        for (const [index, installment] of installments.entries()) {
          const month = Number(installment?.month);
          const year = Number(installment?.year);
          if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) continue;
          const current = await Installment.findOne({
            userId, purchaseId: purchase._id, month, year,
          }).session(session);
          if (!current) {
            await Installment.create([{
              userId, purchaseId: purchase._id, number: index + 1, year, month,
              amount: toSafeNumber(installment.amount, 0),
            }], { session });
            summary.installmentsUpserted++;
          } else if (current.paidAmount === 0) {
            current.number = index + 1;
            current.amount = toSafeNumber(installment.amount, 0);
            await current.save({ session });
          }
        }
      }
      for (const item of Array.isArray(payload.monthlyBudgets) ? payload.monthlyBudgets : []) {
        if (!item || typeof item !== 'object') continue;
        const personId = people.get(key(item.person));
        if (!personId) throw new Error(`Pessoa não encontrada para a planilha "${toSafeText(item.person)}".`);
        const section = SECTION_MAP[key(item.section)];
        if (!section) throw new Error(`Seção de planilha não reconhecida: "${toSafeText(item.section)}".`);
        let sheet = await BudgetSheet.findOne({ userId, personId, year: Number(item.year) || new Date().getFullYear() }).session(session);
        if (!sheet) [sheet] = await BudgetSheet.create([{ userId, personId, year: Number(item.year) || new Date().getFullYear() }], { session });
        let row = sheet.rows.find((candidate) => candidate.section === section && key(candidate.label) === key(item.label));
        if (!row) {
          const position = Math.max(0, ...sheet.rows.map((candidate) => candidate.position || 0)) + 1;
          sheet.rows.push({ section, label: toSafeText(item.label), position, cells: [] });
          row = sheet.rows[sheet.rows.length - 1];
        }
        for (const month of Array.isArray(item.months) ? item.months : []) {
          if (!month || typeof month !== 'object') continue;
          const cell = row.cells.find((candidate) => candidate.month === month.month);
          if (month.amount === null) {
            if (cell) row.cells.splice(row.cells.indexOf(cell), 1);
          } else if (cell) cell.value = toSafeNumber(month.amount, 0);
          else row.cells.push({ month: Number(month.month), value: toSafeNumber(month.amount, 0) });
        }
        await sheet.save({ session });
        summary.budgetsUpserted++;
      }
      for (const item of Array.isArray(payload.birthdays) ? payload.birthdays : []) {
        if (!item || typeof item !== 'object') continue;
        const name = toSafeText(item.name);
        if (!name) continue;
        const day = Number(item.day);
        const month = Number(item.month);
        const exists = await Birthday.exists({
          userId,
          name: new RegExp(`^${asUniqueName(name)}$`, 'i'),
          day: Number.isInteger(day) ? day : null,
          month: Number.isInteger(month) ? month : null,
        }).session(session);
        if (!exists) {
          await Birthday.create([{ userId, name, day, month }], { session });
          summary.birthdaysUpserted++;
        }
      }
    });
  } finally {
    await session.endSession();
  }
  return summary;
}
