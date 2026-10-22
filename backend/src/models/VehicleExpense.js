import mongoose from 'mongoose';

const vehicleExpenseShareSchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const vehicleExpenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    expenseDate: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String, default: '' },
    amount: { type: Number, required: true, min: 1 },
    km: { type: Number, default: null, min: 0 },
    payerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    shared: { type: Boolean, default: false },
    splitMode: { type: String, enum: ['equal', 'percent', 'amount'], default: 'equal' },
    paymentMethod: { type: String, enum: ['cash', 'card'], default: 'cash' },
    requestId: { type: String, default: null },
    shares: { type: [vehicleExpenseShareSchema], default: [] },
  },
  { timestamps: true }
);

vehicleExpenseSchema.index({ userId: 1, vehicleId: 1, expenseDate: 1 });
vehicleExpenseSchema.index({ userId: 1, payerId: 1 });
vehicleExpenseSchema.index(
  { userId: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } }
);

export const VehicleExpense = mongoose.model('VehicleExpense', vehicleExpenseSchema);
