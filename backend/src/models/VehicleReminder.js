import mongoose from 'mongoose';

const vehicleReminderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    type: { type: String, enum: ['oil', 'tires', 'review', 'ipva', 'insurance', 'licensing', 'other'], required: true },
    source: { type: String, enum: ['manual', 'insurance', 'document'], default: 'manual' },
    sourceId: { type: String, default: null },
    title: { type: String, trim: true, maxlength: 80, default: '' },
    rule: { type: String, enum: ['km', 'time', 'km_or_time', 'fixed_date'], required: true },
    intervalKm: { type: Number, min: 1, default: null },
    intervalMonths: { type: Number, min: 1, max: 120, default: null },
    dueDate: { type: String, default: null },
    lastPerformedDate: { type: String, default: null },
    lastPerformedKm: { type: Number, min: 0, default: null },
    active: { type: Boolean, default: true },
    paidAt: { type: String, default: null },
    notifiedStatus: { type: String, enum: ['overdue', 'upcoming', null], default: null },
  },
  { timestamps: true },
);

vehicleReminderSchema.index({ userId: 1, vehicleId: 1, active: 1 });
vehicleReminderSchema.index({ userId: 1, source: 1, sourceId: 1 });

export const VehicleReminder = mongoose.model('VehicleReminder', vehicleReminderSchema);
