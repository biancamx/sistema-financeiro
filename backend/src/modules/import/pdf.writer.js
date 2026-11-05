import { randomUUID } from 'node:crypto';
import { generateInstallments } from '../../lib/cardBilling.js';
import { Card } from '../../models/Card.js';
import { Category } from '../../models/Category.js';
import { Installment } from '../../models/Installment.js';
import { Person } from '../../models/Person.js';
import { Purchase } from '../../models/Purchase.js';
import { importError } from './import.errors.js';
import { normalizeText } from './spreadsheet.reader.js';
import { findExistingPdfPurchaseSignatures, pdfPurchaseSignature } from './pdf.dedup.js';

const MAX_PDF_RECORDS = 300;
const MAX_GENERATED_INSTALLMENTS = 10_000;
const WRITE_BATCH_SIZE = 500;
const monthIndex = (year, month) => year * 12 + month - 1;
const normalizedName = (value) => normalizeText(value).replace(/[^\p{L}\p{N}]/gu, '');
const toCents = (value) => Math.round(Number(value) * 100);
const fromCents = (value) => value / 100;
const validPeriod = (month, year) => Number.isInteger(month) && month >= 1 && month <= 12
  && Number.isInteger(year) && year >= 2000 && year <= 2100;

async function getOrCreateEntity(Model, entities, userId, name, label, defaults = {}) {
  const normalized = normalizedName(name);
  if (!normalized || typeof name !== 'string' || name.trim().length > 100) {
    throw importError(`Nome de ${label} inválido.`);
  }
  const matches = entities.filter((entity) => normalizedName(entity.name) === normalized);
  if (matches.length > 1) {
    throw importError(`O nome "${name}" corresponde a mais de um cadastro de ${label}.`);
  }
  if (matches.length === 1) return { entity: matches[0], created: false };

  const entity = await Model.create({ userId, name: name.trim(), ...defaults });
  entities.push(entity);
  return { entity, created: true };
}

function validateRecord(record, index) {
  const label = String(record?.description ?? '').trim() || `item ${index + 1}`;
  if (!record || !['installment', 'recurring', 'oneTime'].includes(record.kind)) {
    throw importError(`Tipo de compra inválido em "${label}".`);
  }
  if (!label || label.length > 120 || !(Number(record.totalAmount) > 0) || Number(record.totalAmount) > 10_000_000) {
    throw importError(`Descrição ou valor inválido em "${label}".`);
  }
  if (typeof record.cardName !== 'string' || !record.cardName.trim() || record.cardName.length > 80) {
    throw importError(`Cartão inválido na compra "${label}".`);
  }
  if (record.categoryName != null
    && (typeof record.categoryName !== 'string' || !record.categoryName.trim() || record.categoryName.length > 80)) {
    throw importError(`Categoria inválida na compra "${label}".`);
  }
  if (!Array.isArray(record.participants) || record.participants.length < 1 || record.participants.length > 20) {
    throw importError(`Responsáveis inválidos na compra "${label}".`);
  }
  if (record.participants.some((participant) => typeof participant.personName !== 'string'
    || !participant.personName.trim() || participant.personName.length > 100)) {
    throw importError(`Nome de responsável inválido na compra "${label}".`);
  }
  const totalCents = toCents(record.totalAmount);
  const participantCents = record.participants.map((participant) => toCents(participant.allocatedTotal));
  if (participantCents.some((amount) => !Number.isInteger(amount) || amount <= 0)
    || Math.abs(participantCents.reduce((sum, amount) => sum + amount, 0) - totalCents) > 1) {
    throw importError(`O rateio da compra "${label}" não confere com o valor total.`);
  }
  if (record.kind === 'installment') {
    const count = Number(record.totalInstallments);
    if (!Number.isInteger(count) || count < 2 || count > 120
      || !validPeriod(Number(record.startMonth), Number(record.startYear))
      || !validPeriod(Number(record.endMonth), Number(record.endYear))) {
      throw importError(`Quantidade ou período de parcelas inconsistente na compra "${label}".`);
    }
  }
  if (record.kind === 'recurring') {
    const hasEndMonth = record.endMonth != null;
    const hasEndYear = record.endYear != null;
    if (!validPeriod(Number(record.startMonth), Number(record.startYear))
      || hasEndMonth !== hasEndYear
      || (hasEndMonth && (!validPeriod(Number(record.endMonth), Number(record.endYear))
        || monthIndex(Number(record.endYear), Number(record.endMonth))
          < monthIndex(Number(record.startYear), Number(record.startMonth))))) {
      throw importError(`Período recorrente inválido na compra "${label}".`);
    }
  }
  if (record.kind === 'oneTime' && !validPeriod(Number(record.startMonth), Number(record.startYear))) {
    throw importError(`Mês ou ano inválido na compra à vista "${label}".`);
  }
}

function subscriptionEndDate(record) {
  if (record.kind !== 'recurring' || record.endMonth == null) return null;
  return new Date(Date.UTC(Number(record.endYear), Number(record.endMonth), 0, 12));
}

function dateForRecord(record) {
  if (typeof record.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.purchaseDate)) {
    return record.purchaseDate;
  }
  if (record.kind === 'recurring') {
    return `${record.startYear}-${String(record.startMonth).padStart(2, '0')}-01`;
  }
  return null;
}

export async function executePdfPurchaseImport(userId, payload) {
  if (payload?.sourceType !== 'pdf' || !Array.isArray(payload.pdfRecords) || payload.pdfRecords.length === 0) {
    throw importError('A prévia do PDF está vazia ou inválida.');
  }
  if (payload.pdfRecords.length > MAX_PDF_RECORDS) {
    throw importError(`O PDF contém muitos itens. Divida-o em arquivos com até ${MAX_PDF_RECORDS} compras.`);
  }
  if (!Array.isArray(payload.pdfIssues)) {
    throw importError('A prévia do PDF está incompleta ou inválida.');
  }
  payload.pdfRecords.forEach(validateRecord);

  let generatedCount = 0;
  for (const record of payload.pdfRecords) {
    const count = record.kind === 'installment' ? Number(record.totalInstallments) : 1;
    generatedCount += count * record.participants.length;
    if (generatedCount > MAX_GENERATED_INSTALLMENTS) {
      throw importError(`A importação excede o limite de ${MAX_GENERATED_INSTALLMENTS} parcelas. Divida o PDF em partes menores.`);
    }
  }

  const summary = {
    peopleUpserted: 0,
    cardsUpserted: 0,
    categoriesCreated: 0,
    purchasesUpserted: 0,
    purchasesIgnored: 0,
    installmentsUpserted: 0,
    budgetsUpserted: 0,
    birthdaysUpserted: 0,
  };
  const operations = [];
  const handledPeriods = new Set();
  const [people, cards, categories] = await Promise.all([
    Person.find({ userId }).select('name').lean(),
    Card.find({ userId }).select('name').lean(),
    Category.find({ userId }).select('name').lean(),
  ]);
  const existingSignatures = await findExistingPdfPurchaseSignatures(userId, payload.pdfRecords, people, cards);

  try {
    for (const record of payload.pdfRecords) {
      const { entity: card, created: cardCreated } = await getOrCreateEntity(
        Card, cards, userId, record.cardName, 'cartão', {
          limit: 0,
          bank: 'outro',
          issuer: 'Outro',
          brand: 'Outro',
          dueDay: 10,
          closingDay: 3,
          closingDayEqual: 'next',
        },
      );
      if (cardCreated) summary.cardsUpserted += 1;

      let category = null;
      if (record.categoryName) {
        const result = await getOrCreateEntity(
          Category, categories, userId, record.categoryName, 'categoria', {
            type: 'expense',
            color: '#10b981',
            icon: 'Tag',
          },
        );
        category = result.entity;
        if (result.created) summary.categoriesCreated += 1;
      }

      const groupId = record.participants.length > 1 ? randomUUID() : null;
      const count = record.kind === 'installment' ? Number(record.totalInstallments) : 1;
      const purchaseDate = dateForRecord(record);
      const endAt = subscriptionEndDate(record);
      const endHasPassed = endAt
        && monthIndex(endAt.getUTCFullYear(), endAt.getUTCMonth() + 1)
          < monthIndex(new Date().getFullYear(), new Date().getMonth() + 1);
      const subscriptionStatus = endHasPassed ? 'canceled' : 'active';
      const canceledAt = endHasPassed ? endAt : null;

      for (const participant of record.participants) {
        const { entity: person, created: personCreated } = await getOrCreateEntity(
          Person, people, userId, participant.personName, 'pessoa',
        );
        if (personCreated) summary.peopleUpserted += 1;

        const totalAmount = fromCents(toCents(participant.allocatedTotal));
        const signature = pdfPurchaseSignature({
          personId: person._id,
          cardId: card._id,
          description: record.description,
          amount: totalAmount,
          year: record.startYear,
          month: record.startMonth,
        });
        if (existingSignatures.has(signature)) {
          summary.purchasesIgnored += 1;
          continue;
        }
        const query = {
          userId,
          personId: person._id,
          cardId: card._id,
          categoryId: category?._id ?? null,
          description: record.description,
          totalAmount,
          totalInstallments: count,
          purchaseDate,
          isSubscription: record.kind === 'recurring',
          importSourceKey: participant.importSourceKey,
        };
        const schedule = record.kind === 'recurring'
          ? [{ number: 1, month: Number(record.startMonth), year: Number(record.startYear), amount: totalAmount }]
          : generateInstallments({
            total: totalAmount,
            count,
            startYear: Number(record.startYear),
            startMonth: Number(record.startMonth),
          });
        const purchaseData = {
          ...query,
          splitGroupId: groupId,
          subscriptionStatus,
          canceledAt,
          subscriptionEndAt: endAt,
          observation: 'Importado de PDF',
        };

        let purchase = participant.importSourceKey
          ? await Purchase.findOne({ userId, importSourceKey: participant.importSourceKey })
          : await Purchase.findOne(query);
        if (!purchase) {
          purchase = await Purchase.create(purchaseData);
          summary.purchasesUpserted += 1;
        }
        existingSignatures.add(signature);

        const existing = await Installment.find({
          userId,
          purchaseId: purchase._id,
          $or: schedule.map(({ month, year }) => ({ month, year })),
        }).select('_id year month paidAmount').lean();
        const byPeriod = new Map(existing.map((installment) => [`${installment.year}:${installment.month}`, installment]));
        for (const installment of schedule) {
          const periodKey = `${purchase._id}:${installment.year}:${installment.month}`;
          if (handledPeriods.has(periodKey)) continue;
          handledPeriods.add(periodKey);
          const current = byPeriod.get(`${installment.year}:${installment.month}`);
          const subscriptionPeriod = record.kind === 'recurring'
            ? `${purchase._id}:${installment.year}-${String(installment.month).padStart(2, '0')}`
            : undefined;
          if (current) {
            if (current.paidAmount === 0) {
              operations.push({
                updateOne: {
                  filter: { _id: current._id, userId, paidAmount: 0 },
                  update: { $set: { number: installment.number, amount: installment.amount, subscriptionPeriod } },
                },
              });
            }
          } else {
            operations.push({
              updateOne: {
                filter: {
                  userId,
                  purchaseId: purchase._id,
                  year: installment.year,
                  month: installment.month,
                },
                update: {
                  $setOnInsert: {
                    userId,
                    purchaseId: purchase._id,
                    number: installment.number,
                    year: installment.year,
                    month: installment.month,
                    amount: installment.amount,
                    paid: false,
                    paidAmount: 0,
                    subscriptionPeriod,
                  },
                },
                upsert: true,
              },
            });
          }
        }
      }
    }
    for (let offset = 0; offset < operations.length; offset += WRITE_BATCH_SIZE) {
      const result = await Installment.bulkWrite(operations.slice(offset, offset + WRITE_BATCH_SIZE), { ordered: false });
      summary.installmentsUpserted += result.upsertedCount;
    }
  } catch (error) {
    console.error('[PDF IMPORT WRITE ERROR]', error instanceof Error ? error.message : String(error));
    throw error;
  }
  return summary;
}
