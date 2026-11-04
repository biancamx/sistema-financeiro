import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['expense', 'income', 'both'], default: 'both' },
    color: { type: String, default: '#10b981' },
    icon: { type: String, default: 'Tag', maxlength: 40 },
  },
  { timestamps: true }
);

categorySchema.index({ userId: 1, name: 1 }, { unique: true });

export const Category = mongoose.model('Category', categorySchema);
