import mongoose from 'mongoose';

const cashEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['expense', 'sale', 'loan', 'refund'], required: true },
    description: { type: String, required: true, trim: true },
    totalCents: { type: Number, required: true, min: 0 },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    counterparty: { type: String, default: null },
    entryDate: { type: String, required: true },
    paymentMethod: { type: String, default: null },
    downPaymentCents: { type: Number, default: 0, min: 0 },
    installmentCount: { type: Number, default: 1, min: 1 },
    firstDueDate: { type: String, default: null },
    frequency: { type: String, enum: ['monthly', 'biweekly', 'weekly'], default: 'monthly' },
    loanTerm: { type: String, enum: ['date', 'installments', 'none', null], default: null },
    interestRateBps: { type: Number, default: 0 },
    protocol: { type: String, default: null },
    expectedReturnDate: { type: String, default: null },
    refundStatus: { type: String, enum: ['requested', 'in_review', 'received', 'denied', null], default: null },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    vehicleExpenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleExpense', default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

cashEntrySchema.index({ userId: 1, entryDate: 1 });
cashEntrySchema.index({ userId: 1, kind: 1, entryDate: 1 });
cashEntrySchema.index({ userId: 1, personId: 1 });
cashEntrySchema.index(
  { userId: 1, vehicleExpenseId: 1 },
  { unique: true, partialFilterExpression: { vehicleExpenseId: { $type: 'objectId' } } }
);

export const CashEntry = mongoose.model('CashEntry', cashEntrySchema);
