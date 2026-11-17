import mongoose from 'mongoose';

const budgetCellSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    value: { type: Number, required: true, default: 0 },
    paid: { type: Boolean, default: false },
  },
  { _id: false }
);

const budgetRowSchema = new mongoose.Schema({
  section: { type: String, required: true },
  label: { type: String, required: true },
  position: { type: Number, default: 0 },
  receivableFrom: { type: String, default: null },
  obs: { type: String, default: null },
  cells: {
    type: [budgetCellSchema],
    default: [],
    validate: {
      validator(cells) {
        return new Set(cells.map((cell) => cell.month)).size === cells.length;
      },
      message: 'Cada linha da planilha só pode ter um valor por mês.',
    },
  },
});

const budgetSheetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    year: { type: Number, required: true },
    rows: { type: [budgetRowSchema], default: [] },
  },
  { timestamps: true }
);

budgetSheetSchema.index({ userId: 1, personId: 1, year: 1 }, { unique: true });

export const BudgetSheet = mongoose.model('BudgetSheet', budgetSheetSchema);
