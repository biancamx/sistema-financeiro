import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true, maxlength: 2048 },
    keys: {
      p256dh: { type: String, required: true, select: false },
      auth: { type: String, required: true, select: false },
    },
    userAgent: { type: String, default: '', maxlength: 512 },
  },
  { timestamps: true },
);

pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ userId: 1 });

export const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
