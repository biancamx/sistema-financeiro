import { analyzeSpreadsheet } from './spreadsheet.reader.js';
import { executeSpreadsheetImport } from './spreadsheet.writer.js';
import { Installment } from '../../models/Installment.js';
import { Purchase } from '../../models/Purchase.js';

function normalizeImportPayload(analyzedData) {
  if (!analyzedData || typeof analyzedData !== 'object') {
    throw new Error('Payload da importação inválido.');
  }
  const normalized = { ...analyzedData };
  normalized.people = Array.isArray(normalized.people) ? normalized.people : [];
  normalized.cards = Array.isArray(normalized.cards) ? normalized.cards : [];
  normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [];
  normalized.purchasesGrouped = Array.isArray(normalized.purchasesGrouped) ? normalized.purchasesGrouped : [];
  normalized.monthlyBudgets = Array.isArray(normalized.monthlyBudgets) ? normalized.monthlyBudgets : [];
  normalized.birthdays = Array.isArray(normalized.birthdays) ? normalized.birthdays : [];
  normalized.limits = normalized.limits && typeof normalized.limits === 'object' ? normalized.limits : {};
  return normalized;
}

export async function processSpreadsheetImport(userId, fileBuffer, { replaceExisting = false } = {}) {
  if (!userId) {
    throw new Error('Identificação do usuário ausente para a importação.');
  }
  const isEmptyBuffer = Buffer.isBuffer(fileBuffer) ? fileBuffer.length === 0 : false;
  if (!fileBuffer || isEmptyBuffer || (typeof fileBuffer === 'string' && !fileBuffer.length)) {
    throw new Error('Arquivo da planilha ausente.');
  }

  try {
    const analyzedData = normalizeImportPayload(analyzeSpreadsheet(fileBuffer));
    return executeSpreadsheetImport(userId, analyzedData, { replaceExisting });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao processar a planilha.';
    console.error('[IMPORT SERVICE ERROR]', message);
    throw new Error(message);
  }
}

export async function undoSpreadsheetImport(userId, batchId = null) {
  const filter = { userId, ...(batchId ? { splitGroupId: batchId } : { vehicleExpenseId: null }) };
  let count = 0;
  try {
    const purchases = await Purchase.find(filter).select('_id');
    count = purchases.length;
    if (count > 0) {
      await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } });
      await Purchase.deleteMany(filter);
    }
  } catch (error) {
    console.error('[IMPORT UNDO ERROR]', error);
    throw new Error(error instanceof Error ? error.message : 'Erro ao reverter importação.');
  }
  return { undoneCount: count };
}
