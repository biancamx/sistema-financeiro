import mongoose from 'mongoose';
import { analyzeSpreadsheet } from './spreadsheet.reader.js';
import { executeSpreadsheetImport } from './spreadsheet.writer.js';
import { Installment } from '../../models/Installment.js';
import { Purchase } from '../../models/Purchase.js';

export async function processSpreadsheetImport(userId, fileBuffer, { replaceExisting = false } = {}) {
  const analyzedData = analyzeSpreadsheet(fileBuffer);
  return executeSpreadsheetImport(userId, analyzedData, { replaceExisting });
}

export async function undoSpreadsheetImport(userId, batchId = null) {
  const filter = { userId, ...(batchId ? { splitGroupId: batchId } : { vehicleExpenseId: null }) };
  const session = await mongoose.startSession();
  let count = 0;
  try {
    await session.withTransaction(async () => {
      const purchases = await Purchase.find(filter).select('_id').session(session);
      count = purchases.length;
      await Installment.deleteMany({ userId, purchaseId: { $in: purchases.map((item) => item._id) } }, { session });
      await Purchase.deleteMany(filter, { session });
    });
  } finally {
    await session.endSession();
  }
  return { undoneCount: count };
}
