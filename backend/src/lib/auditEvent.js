import { AuditEvent } from '../models/AuditEvent.js';

export function recordAuditEvent(event) {
  return AuditEvent.create(event);
}
