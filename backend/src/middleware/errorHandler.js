import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { raiseUnavailableRecordAlerts, securitySourceKey } from '../lib/securityAlerts.js';
import { recordAuditEvent } from '../lib/auditEvent.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Rota não encontrada'));
}

// Camada "Error Tracking": todo erro passa por aqui, vira log estruturado com requestId.
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' };

  if (err instanceof ZodError) {
    status = 400;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    };
  } else if (err instanceof AppError) {
    status = err.status;
    body = { code: err.code, message: err.message, details: err.details };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'BAD_JSON', message: 'JSON inválido' };
  } else if (err.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'Corpo da requisição excede o limite permitido' };
  }

  const log = req.log || logger;
  if (status === 404 && req.user && req.route) {
    const targetId = Object.values(req.params || {}).find((value) => /^[\da-f]{24}$/i.test(String(value)));
    if (targetId) {
      void recordUnavailableRecordAttempt(req, targetId).catch((auditError) => {
        log.error({ errorName: auditError.name, requestId: req.id }, 'Falha ao registrar tentativa de acesso negada');
      });
    }
  }
  if (status >= 500) {
    log.error({ errorName: err.name, errorCode: err.code, requestId: req.id }, 'erro não tratado');
  } else {
    log.warn({ code: body.code, status, requestId: req.id }, 'requisição rejeitada');
  }

  res.status(status).json({ error: { ...body, requestId: req.id } });
}

async function recordUnavailableRecordAttempt(req, targetId) {
  const sourceKey = securitySourceKey(req.ip);
  await recordAuditEvent({
    eventType: 'access.denied',
    actorUserId: req.user._id,
    targetUserId: req.user._id,
    targetId,
    sourceKey,
    requestId: req.id,
  });
  await raiseUnavailableRecordAlerts({
    actorUserId: req.user._id,
    sourceKey,
    requestId: req.id,
  });
}
