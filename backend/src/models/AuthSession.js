import mongoose from 'mongoose';

const authSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenId: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

export const AuthSession = mongoose.model('AuthSession', authSessionSchema);
