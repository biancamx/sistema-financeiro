import mongoose from 'mongoose';

const installmentSchema = new mongoose.Schema({
  installmentNumber: { type: Number, required: true },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  amount: { type: Number, required: true },
  paidAmount: { type: Number, default: 0 },
  paid: { type: Boolean, default: false },
});

const purchaseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', default: null, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, required: true, trim: true },
    totalAmount: { type: Number, required: true },
    totalInstallments: { type: Number, required: true, default: 1 },
    splitGroupId: { type: String, default: null, index: true },
    installments: [installmentSchema], // parcelas ficam embutidas aqui!
  },
  { timestamps: true }
);

// Índices para busca ultra rápida nas faturas do mês
purchaseSchema.index({ userId: 1, 'installments.month': 1, 'installments.year': 1 });

export const Purchase = mongoose.model('Purchase', purchaseSchema);