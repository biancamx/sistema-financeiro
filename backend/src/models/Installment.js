import mongoose from 'mongoose';

const installmentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', required: true },
    number: { type: Number, required: true, min: 1 },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    amount: { type: Number, required: true },
    paid: { type: Boolean, default: false },
    paidAmount: { type: Number, default: 0, min: 0 },
    subscriptionPeriod: { type: String, default: undefined },
  },
  { timestamps: true }
);

installmentSchema.index({ userId: 1, year: 1, month: 1 });
installmentSchema.index({ userId: 1, purchaseId: 1, number: 1 });
installmentSchema.index(
  { userId: 1, subscriptionPeriod: 1 },
  { unique: true, partialFilterExpression: { subscriptionPeriod: { $type: 'string' } } },
);

export const Installment = mongoose.model('Installment', installmentSchema);
