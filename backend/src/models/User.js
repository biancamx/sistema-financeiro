import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ['active', 'pending', 'blocked'], default: 'pending', index: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user', index: true },
    passwordHash: { type: String, default: null }, // nulo se for login com Google
    googleId: { type: String, default: null },
    avatar: { type: String, default: null },
    picture: { type: String, default: null },
    provider: { type: String, enum: ['password', 'google', 'local'], default: 'password' },
    aiProvider: { type: String, enum: ['gemini', 'openai', 'anthropic'], default: null },
    aiModel: { type: String, default: null },
    aiApiKeyEncrypted: { type: String, default: null, select: false },
    aiDataConsentAt: { type: Date, default: null, select: false },
    categoriesInitialized: { type: Boolean, default: false },
    portalContactPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    reminderSettings: {
      enabled: { type: Boolean, default: true },
      triggerDay: { type: Number, default: 5, min: 1, max: 31 },
      triggerHour: { type: Number, default: 9, min: 0, max: 23 },
      autoSend: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);

export const User = mongoose.model('User', userSchema);