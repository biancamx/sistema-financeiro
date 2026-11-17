import mongoose from 'mongoose';

const vehicleDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ['crlv', 'policy', 'purchase_invoice', 'other'], required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], required: true },
    size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
    dueDate: { type: String, default: null },
  },
  { timestamps: true },
);

vehicleDocumentSchema.index({ userId: 1, vehicleId: 1, createdAt: -1 });

export const VehicleDocument = mongoose.model('VehicleDocument', vehicleDocumentSchema);
