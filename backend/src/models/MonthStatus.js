import mongoose from 'mongoose';

const monthStatusSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    status: { type: String, enum: ['pending', 'paid'], required: true },
  },
  { timestamps: true }
);

monthStatusSchema.index({ userId: 1, personId: 1, year: 1, month: 1 }, { unique: true });

export const MonthStatus = mongoose.model('MonthStatus', monthStatusSchema);
