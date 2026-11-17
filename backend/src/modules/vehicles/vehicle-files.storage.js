import mongoose from 'mongoose';

const bucketName = 'vehicleFiles';

function getBucket() {
  const { db } = mongoose.connection;
  if (!db) throw new Error('O armazenamento de arquivos do MongoDB ainda não está disponível.');
  return new mongoose.mongo.GridFSBucket(db, { bucketName });
}

export function uploadVehicleFile(buffer, { filename, contentType, metadata }) {
  return new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(filename, { contentType, metadata });
    stream.once('finish', () => resolve(stream.id));
    stream.once('error', reject);
    stream.end(buffer);
  });
}

export async function deleteVehicleFile(fileId) {
  const id = new mongoose.Types.ObjectId(fileId);
  const bucket = getBucket();
  const [file] = await bucket.find({ _id: id }).limit(1).toArray();
  if (file) await bucket.delete(id);
}

export async function getVehicleFile(fileId) {
  const id = new mongoose.Types.ObjectId(fileId);
  const bucket = getBucket();
  const [file] = await bucket.find({ _id: id }).limit(1).toArray();
  return file ? { file, stream: bucket.openDownloadStream(id) } : null;
}

export async function deleteVehicleFilesForUser(userId) {
  const bucket = getBucket();
  const files = await bucket.find({ 'metadata.userId': String(userId) }).toArray();
  await Promise.all(files.map((file) => bucket.delete(file._id)));
}
