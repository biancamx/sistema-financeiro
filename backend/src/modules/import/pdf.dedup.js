import { Installment } from '../../models/Installment.js';
import { Purchase } from '../../models/Purchase.js';
import { normalizeText } from './spreadsheet.reader.js';

const normalizedName = (value) => normalizeText(value).replace(/[^\p{L}\p{N}]/gu, '');
const cents = (value) => Math.round(Number(value) * 100);
const periodKey = (year, month) => `${Number(year)}:${Number(month)}`;

export function pdfPurchaseSignature({ personId, cardId, description, amount, year, month }) {
  return [
    String(personId),
    String(cardId),
    normalizedName(description),
    cents(amount),
    periodKey(year, month),
  ].join(':');
}

export async function findExistingPdfPurchaseSignatures(userId, records, people, cards, session) {
  const peopleByName = new Map(people.map((person) => [normalizedName(person.name), person]));
  const cardsByName = new Map(cards.map((card) => [normalizedName(card.name), card]));
  const expected = [];
  for (const record of records) {
    for (const participant of record.participants) {
      const person = peopleByName.get(normalizedName(participant.personName));
      const card = cardsByName.get(normalizedName(record.cardName));
      if (!person || !card) continue;
      expected.push({
        personId: person._id,
        cardId: card._id,
        description: record.description,
        amount: participant.allocatedTotal,
        year: record.startYear,
        month: record.startMonth,
      });
    }
  }
  if (!expected.length) return new Set();

  const personIds = [...new Set(expected.map(({ personId }) => String(personId)))];
  const cardIds = [...new Set(expected.map(({ cardId }) => String(cardId)))];
  const amounts = [...new Set(expected.map(({ amount }) => cents(amount)))].map((amount) => amount / 100);
  let purchaseQuery = Purchase.find({
    userId,
    personId: { $in: personIds },
    cardId: { $in: cardIds },
    totalAmount: { $in: amounts },
  }).select('_id personId cardId description totalAmount');
  if (session) purchaseQuery = purchaseQuery.session(session);
  const purchases = await purchaseQuery.lean();
  if (!purchases.length) return new Set();

  const expectedPeriods = [...new Map(expected.map(({ year, month }) => [
    periodKey(year, month),
    { year: Number(year), month: Number(month) },
  ])).values()];
  let installmentQuery = Installment.find({
    userId,
    purchaseId: { $in: purchases.map(({ _id }) => _id) },
    $or: expectedPeriods.map(({ year, month }) => ({ year, month })),
  }).select('purchaseId year month');
  if (session) installmentQuery = installmentQuery.session(session);
  const installments = await installmentQuery.lean();
  const purchaseById = new Map(purchases.map((purchase) => [String(purchase._id), purchase]));
  const expectedKeys = new Set(expected.map((item) => pdfPurchaseSignature(item)));
  const signatures = new Set();

  for (const installment of installments) {
    const purchase = purchaseById.get(String(installment.purchaseId));
    if (!purchase) continue;
    const signature = pdfPurchaseSignature({
      personId: purchase.personId,
      cardId: purchase.cardId,
      description: purchase.description,
      amount: purchase.totalAmount,
      year: installment.year,
      month: installment.month,
    });
    if (expectedKeys.has(signature)) signatures.add(signature);
  }
  return signatures;
}
