import mongoose from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';

export const LEGACY_SHARE_TOKEN_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{6,64}$/;

export function generatePortalToken() {
  return randomBytes(32).toString('base64url');
}

export function hashPortalToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const personSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: null, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    birthDate: { type: String, default: null }, // YYYY-MM-DD
    pixKey: { type: String, default: null, trim: true },
    avatar: { type: String, default: null },
    notes: { type: String, default: null },
    shareToken: {
      type: String,
      default: undefined,
    },
    shareTokenHash: { type: String, default: undefined, select: false },
    shareTokenExpiresAt: { type: Date, default: null },
    shareTokenRevokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Garante isolamento: o nome é único por usuário, não no banco inteiro!
personSchema.index({ userId: 1, name: 1 }, { unique: true });
personSchema.index({ userId: 1, email: 1 });
personSchema.index(
  { shareToken: 1 },
  {
    unique: true,
    partialFilterExpression: { shareToken: { $type: 'string' } },
    name: 'shareToken_string_unique',
  },
);
personSchema.index(
  { shareTokenHash: 1 },
  { unique: true, partialFilterExpression: { shareTokenHash: { $type: 'string' } } },
);

export const Person = mongoose.model('Person', personSchema);