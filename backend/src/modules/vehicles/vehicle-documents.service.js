import { randomUUID } from 'node:crypto';
import { notFound } from '../../lib/errors.js';
import { Vehicle } from '../../models/Vehicle.js';
import { VehicleDocument } from '../../models/VehicleDocument.js';
import { VehicleReminder } from '../../models/VehicleReminder.js';
import { deleteVehicleFile, getVehicleFile, uploadVehicleFile } from './vehicle-files.storage.js';

const TYPES = { crlv: 'CRLV', policy: 'Apólice', purchase_invoice: 'Nota de compra', other: 'Outro' };

function documentShape(document) {
  return {
    id: String(document._id), vehicleId: String(document.vehicleId), name: document.name,
    type: document.type, typeLabel: TYPES[document.type], originalName: document.originalName,
    contentType: document.contentType, size: document.size, dueDate: document.dueDate,
    fileUrl: `/api/vehicles/documents/${document._id}/file`,
    downloadUrl: `/api/vehicles/documents/${document._id}/download`,
  };
}

async function syncDocumentReminder(document) {
  const filter = { userId: document.userId, vehicleId: document.vehicleId, source: 'document', sourceId: String(document._id) };
  if (!document.dueDate) {
    await VehicleReminder.deleteMany(filter);
    return;
  }
  await VehicleReminder.findOneAndUpdate(
    filter,
    {
      $set: {
        type: 'other', title: `Validade: ${document.name}`.slice(0, 80),
        rule: 'fixed_date', dueDate: document.dueDate, active: true,
        paidAt: null, notifiedStatus: null,
      },
      $setOnInsert: {
        userId: document.userId, vehicleId: document.vehicleId, source: 'document',
        sourceId: String(document._id), intervalKm: null, intervalMonths: null,
        lastPerformedDate: null, lastPerformedKm: null,
      },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

export async function listVehicleDocuments(userId, vehicleId) {
  const filter = { userId, ...(vehicleId && { vehicleId }) };
  const documents = await VehicleDocument.find(filter).sort({ createdAt: -1 }).lean();
  return documents.map(documentShape);
}

export async function createVehicleDocument(userId, data, file, contentType) {
  if (!await Vehicle.exists({ _id: data.vehicleId, userId })) throw notFound('Veículo não encontrado');
  const originalName = String(file.originalname || 'documento').replace(/[\r\n]/g, '').slice(0, 255);
  const safeExtension = contentType === 'application/pdf' ? 'pdf' : contentType.split('/')[1];
  const fileId = await uploadVehicleFile(file.buffer, {
    filename: `${data.vehicleId}-${randomUUID()}.${safeExtension}`,
    contentType,
    metadata: { userId: String(userId), vehicleId: String(data.vehicleId), purpose: 'vehicle-document' },
  });
  let document;
  try {
    [document] = await VehicleDocument.create([{
      userId, vehicleId: data.vehicleId, name: data.name, type: data.type,
      fileId, originalName, contentType, size: file.size, dueDate: data.dueDate ?? null,
    }]);
    await syncDocumentReminder(document);
  } catch (error) {
    if (document) await VehicleDocument.deleteOne({ _id: document._id, userId });
    await deleteVehicleFile(fileId);
    throw error;
  }
  return documentShape(document.toObject());
}

export async function getVehicleDocumentFile(userId, id) {
  const document = await VehicleDocument.findOne({ _id: id, userId }).lean();
  if (!document) throw notFound('Documento não encontrado');
  const stored = await getVehicleFile(document.fileId);
  if (!stored) throw notFound('Arquivo do documento não encontrado');
  return { ...stored, document: documentShape(document) };
}

export async function removeVehicleDocument(userId, id) {
  const document = await VehicleDocument.findOneAndDelete({ _id: id, userId });
  if (!document) throw notFound('Documento não encontrado');
  await VehicleReminder.deleteMany({
    userId, vehicleId: document.vehicleId, source: 'document', sourceId: String(document._id),
  });
  await deleteVehicleFile(document.fileId);
}
