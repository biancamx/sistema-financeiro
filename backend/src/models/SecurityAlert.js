import mongoose from 'mongoose';

const securityAlertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  alertType: {
    type: String,
    enum: ['repeated_login_failures', 'revoked_session_reuse', 'cross_user_access', 'admin_account_change'],
    required: true,
    immutable: true,
  },
  dedupeKey: { type: String, required: true, maxlength: 256, immutable: true },
  requestId: { type: String, default: null, maxlength: 128, immutable: true },
  readAt: { type: Date, default: null },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), index: { expires: 0 } },
}, { timestamps: true, versionKey: false });

securityAlertSchema.index({ userId: 1, createdAt: -1 });
securityAlertSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });

export const SecurityAlert = mongoose.model('SecurityAlert', securityAlertSchema);
