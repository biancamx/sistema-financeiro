import mongoose from 'mongoose';

const cashInstallmentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    entryId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashEntry', required: true },
    number: { type: Number, required: true, min: 1 },
    count: { type: Number, required: true, min: 1 },
    amountCents: { type: Number, required: true, min: 0 },
    dueDate: { type: String, default: null },
  },
  { timestamps: true }
);

cashInstallmentSchema.index({ userId: 1, dueDate: 1 });
cashInstallmentSchema.index({ userId: 1, entryId: 1 });

export const CashInstallment = mongoose.model('CashInstallment', cashInstallmentSchema);
