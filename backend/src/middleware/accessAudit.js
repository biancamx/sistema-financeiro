import { logger } from '../lib/logger.js';
import { AccessAuditLog } from '../models/AccessAuditLog.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && emailPattern.test(email) ? email : null;
}

export function auditAccessEvent(event, provider = 'unknown') {
  return (req, res, next) => {
    if (event === 'logout' && !req.user) return next();

    res.once('finish', () => {
      const user = req.auditUser || req.user;
      const email = normalizedEmail(req.body?.email || user?.email);
      const record = {
        event: req.auditEvent || event,
        outcome: res.statusCode >= 200 && res.statusCode < 400 ? 'success' : 'failure',
        userId: user?._id || user?.id || null,
        email,
        provider,
        ipAddress: typeof req.ip === 'string' ? req.ip.slice(0, 64) : null,
        userAgent: typeof req.get('user-agent') === 'string' ? req.get('user-agent').slice(0, 500) : null,
      };

      Promise.resolve()
        .then(() => AccessAuditLog.create(record))
        .catch((error) => {
          if (req.log) {
            req.log.error({ err: error, event }, 'Failed to persist access audit event');
          } else {
            logger.error({ err: error, event }, 'Failed to persist access audit event');
          }
        });
    });

    return next();
  };
}
