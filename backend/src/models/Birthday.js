import mongoose from 'mongoose';

const birthdaySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    name: { type: String, required: true, trim: true },
    day: { type: Number, required: true, min: 1, max: 31 },
    month: { type: Number, required: true, min: 1, max: 12 },
  },
  { timestamps: true }
);

birthdaySchema.index({ userId: 1, month: 1, day: 1 });
birthdaySchema.index(
  { userId: 1, personId: 1 },
  { unique: true, partialFilterExpression: { personId: { $type: 'objectId' } } }
);

export const Birthday = mongoose.model('Birthday', birthdaySchema);
