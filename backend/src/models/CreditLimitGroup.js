import mongoose from 'mongoose';

const creditLimitGroupSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    institution: { type: String, required: true, trim: true, maxlength: 80 },
    limit: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

creditLimitGroupSchema.index({ userId: 1, name: 1 });

export const CreditLimitGroup = mongoose.model('CreditLimitGroup', creditLimitGroupSchema);
