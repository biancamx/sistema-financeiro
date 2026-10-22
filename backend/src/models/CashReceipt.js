import mongoose from 'mongoose';

const cashReceiptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    installmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashInstallment', required: true },
    amountCents: { type: Number, required: true, min: 1 },
    receivedOn: { type: String, required: true },
    paymentMethod: { type: String, required: true },
  },
  { timestamps: true }
);

cashReceiptSchema.index({ userId: 1, installmentId: 1 });

export const CashReceipt = mongoose.model('CashReceipt', cashReceiptSchema);
