import mongoose from 'mongoose';
import crypto from 'node:crypto';

const SHARE_TOKEN_CHARS = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const SHARE_TOKEN_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{6,64}$/;

export function generateShortToken(length = 10) {
  const bytes = crypto.randomBytes(length);
  return Array.from({ length }, (_, index) => SHARE_TOKEN_CHARS[bytes[index] % SHARE_TOKEN_CHARS.length]).join('');
}

function isValidShareToken(token) {
  return typeof token === 'string' && SHARE_TOKEN_PATTERN.test(token);
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
      default: () => generateShortToken(10),
    },
  },
  { timestamps: true }
);

personSchema.pre('validate', function ensureShareToken() {
  if (!isValidShareToken(this.shareToken)) {
    this.shareToken = generateShortToken(10);
  }
});

personSchema.pre('save', function ensureShareTokenOnSave() {
  if (!isValidShareToken(this.shareToken)) {
    this.shareToken = generateShortToken(10);
  }
});

// Garante isolamento: o nome é único por usuário, não no banco inteiro!
personSchema.index({ userId: 1, name: 1 }, { unique: true });
personSchema.index({ userId: 1, email: 1 });

export async function ensurePersonShareTokens() {
  const people = await Person.find({}).select('_id shareToken').lean();
  for (const person of people) {
    if (!isValidShareToken(person.shareToken)) {
      let token = generateShortToken(10);
      let tries = 0;
      while (await Person.exists({ shareToken: token, _id: { $ne: person._id } })) {
        token = generateShortToken(10);
        tries += 1;
        if (tries > 20) throw new Error('Não foi possível gerar token único para pessoa');
      }
      await Person.updateOne({ _id: person._id }, { $set: { shareToken: token } });
    }
  }
}

export const Person = mongoose.model('Person', personSchema);