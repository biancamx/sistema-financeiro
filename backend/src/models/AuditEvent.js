import mongoose from 'mongoose';

const eventTypes = [
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.account.registered',
  'auth.session.revoked',
  'auth.sessions.revoked',
  'auth.session.reuse_detected',
  'admin.user_status_changed',
  'admin.role_changed',
  'share.link.created',
  'share.link.revoked',
  'data.exported',
  'access.denied',
];

const auditEventSchema = new mongoose.Schema({
  eventType: { type: String, enum: eventTypes, required: true, immutable: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  targetId: { type: String, default: null, maxlength: 128, immutable: true },
  sourceKey: { type: String, default: null, maxlength: 64, immutable: true },
  requestId: { type: String, default: null, maxlength: 128, immutable: true },
  previousStatus: { type: String, default: null, immutable: true },
  newStatus: { type: String, default: null, immutable: true },
  previousRole: { type: String, default: null, immutable: true },
  newRole: { type: String, default: null, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false, strict: 'throw' });

auditEventSchema.index({ createdAt: -1, _id: -1 });
auditEventSchema.index({ eventType: 1, createdAt: -1 });
auditEventSchema.index({ eventType: 1, sourceKey: 1, createdAt: -1 });
auditEventSchema.index({ eventType: 1, actorUserId: 1, createdAt: -1 });
auditEventSchema.index({ eventType: 1, targetUserId: 1, createdAt: -1 });
auditEventSchema.index({ eventType: 1, actorUserId: 1, sourceKey: 1, createdAt: -1 });

auditEventSchema.pre('save', function preventAuditMutation() {
  if (!this.isNew) throw new Error('Audit events are append-only.');
});

auditEventSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'replaceOne'], function preventAuditQueryMutation() {
  throw new Error('Audit events are append-only.');
});

export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);
