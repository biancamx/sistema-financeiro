import mongoose from 'mongoose';

const purchaseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    vehicleExpenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleExpense', default: null },
    description: { type: String, required: true, trim: true },
    purchaseDate: { type: String, default: null },
    totalAmount: { type: Number, required: true },
    totalInstallments: { type: Number, required: true, default: 1 },
    isSubscription: { type: Boolean, default: false },
    subscriptionStatus: { type: String, enum: ['active', 'canceled'], default: 'active' },
    canceledAt: { type: Date, default: null },
    subscriptionEndAt: { type: Date, default: null },
    importSourceKey: { type: String, default: undefined },
    splitGroupId: { type: String, default: null, index: true },
    observation: { type: String, default: '' },
  },
  { timestamps: true }
);

purchaseSchema.index({ userId: 1, personId: 1, cardId: 1 });
purchaseSchema.index({ userId: 1, cardId: 1 });
purchaseSchema.index({ userId: 1, categoryId: 1 });
purchaseSchema.index({ userId: 1, _id: -1 });
purchaseSchema.index({ userId: 1, splitGroupId: 1 });
purchaseSchema.index({ userId: 1, vehicleExpenseId: 1 }, { sparse: true });
purchaseSchema.index(
  { userId: 1, importSourceKey: 1 },
  { unique: true, partialFilterExpression: { importSourceKey: { $type: 'string' } } },
);

export const Purchase = mongoose.model('Purchase', purchaseSchema);