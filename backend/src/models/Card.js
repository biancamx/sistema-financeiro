import mongoose from 'mongoose';

const cardBrands = new Map([
  ['visa', 'Visa'],
  ['mastercard', 'Mastercard'],
  ['elo', 'Elo'],
  ['american express', 'American Express'],
  ['amex', 'American Express'],
]);

export function normalizeCardBrand(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Outro';
  return cardBrands.get(value.trim().toLowerCase()) ?? 'Outro';
}

const cardSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    limit: { type: Number, default: 0 },
    color: { type: String, default: '#0f6b66' },
    bank: { type: String, default: 'outro' },
    issuer: { type: String, default: 'Outro' },
    brand: { type: String, default: 'Outro', set: normalizeCardBrand },
    lastDigits: { type: String, default: null, maxlength: 4 },
    holderPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    image: { type: String, default: null },
    imageData: { type: String, default: null },
    dueDay: { type: Number, default: 10, min: 1, max: 31 }, // dia do vencimento
    closingDay: { type: Number, default: 3, min: 1, max: 31 }, // dia do fechamento
    closingDayEqual: { type: String, enum: ['current', 'next'], default: 'next' },
  },
  { timestamps: true }
);

// Isolamento: nome do cartão único por usuário
cardSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Card = mongoose.model('Card', cardSchema);