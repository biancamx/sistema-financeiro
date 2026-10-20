import mongoose from 'mongoose';
import crypto from 'node:crypto';

function generateShortToken(length = 8) {
  const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  let token = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
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
      unique: true,
      default: () => generateShortToken(8),
    },
  },
  { timestamps: true }
);

// Garante isolamento: o nome é único por usuário, não no banco inteiro!
personSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Person = mongoose.model('Person', personSchema);