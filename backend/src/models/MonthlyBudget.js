import mongoose from 'mongoose';

const monthlyBudgetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    section: { type: String, required: true, enum: ['receitas', 'beneficios', 'despesas', 'contas_fixas'] },
    category: { type: String, required: true },
    label: { type: String, required: true },
    amount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Isolamento rigoroso: cada usuário tem sua própria planilha sem colisão
monthlyBudgetSchema.index({ userId: 1, personId: 1, year: 1, month: 1 });

export const MonthlyBudget = mongoose.model('MonthlyBudget', monthlyBudgetSchema);