import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['car', 'motorcycle', 'utility', 'other'], default: 'car' },
    model: { type: String, required: true, trim: true },
    plate: { type: String, required: true, uppercase: true, trim: true },
    year: { type: Number, default: null },
    purchaseValue: { type: Number, default: 0 },
    currentKm: { type: Number, default: null, min: 0 },
    insuranceDueDate: { type: String, default: null },
    photoUrl: { type: String, default: null },
    photoThumbnailUrl: { type: String, default: null },
    photoFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    photoThumbnailFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    photoContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], default: null },
    photoThumbnailContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], default: null },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    status: { type: String, enum: ['active', 'inactive', 'sold'], default: 'active' },
    soldDate: { type: String, default: null },
    soldValueCents: { type: Number, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

vehicleSchema.index({ userId: 1, plate: 1 }, { unique: true });

export const Vehicle = mongoose.model('Vehicle', vehicleSchema);
