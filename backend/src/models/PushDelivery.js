import mongoose from 'mongoose';

const pushDeliverySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    alertId: { type: String, required: true, maxlength: 300 },
    alertStatus: { type: String, enum: ['today', 'overdue'], required: true },
    state: { type: String, enum: ['sending', 'sent', 'pending'], default: 'pending', required: true },
    lockId: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

pushDeliverySchema.index({ userId: 1, alertId: 1, alertStatus: 1 }, { unique: true });

export const PushDelivery = mongoose.model('PushDelivery', pushDeliverySchema);
