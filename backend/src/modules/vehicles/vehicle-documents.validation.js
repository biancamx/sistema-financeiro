import { detectImageContentType } from './vehicle-files.validation.js';

export function detectVehicleDocumentContentType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return detectImageContentType(buffer);
}
