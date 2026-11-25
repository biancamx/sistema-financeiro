import mongoose from 'mongoose';

const accessAuditLogSchema = new mongoose.Schema(
  {
    event: { type: String, enum: ['login', 'registration', 'logout'], required: true },
    outcome: { type: String, enum: ['success', 'failure'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, lowercase: true, trim: true, maxlength: 254, default: null },
    provider: { type: String, enum: ['password', 'google', 'local', 'unknown'], default: 'unknown' },
    ipAddress: { type: String, maxlength: 64, default: null },
    userAgent: { type: String, maxlength: 500, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

accessAuditLogSchema.index({ userId: 1, createdAt: -1 });
accessAuditLogSchema.index({ email: 1, createdAt: -1 });
accessAuditLogSchema.index({ createdAt: -1 });

export const AccessAuditLog = mongoose.model('AccessAuditLog', accessAuditLogSchema);
