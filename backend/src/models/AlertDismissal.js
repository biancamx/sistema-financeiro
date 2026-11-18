import mongoose from 'mongoose';

const alertDismissalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    alertKey: { type: String, required: true, match: /^[\da-f]{64}$/i },
    dismissedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

alertDismissalSchema.index({ userId: 1, alertKey: 1 }, { unique: true });

export const AlertDismissal = mongoose.model('AlertDismissal', alertDismissalSchema);
