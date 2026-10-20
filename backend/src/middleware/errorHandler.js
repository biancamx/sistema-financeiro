import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Rota não encontrada: ${req.method} ${req.originalUrl}`));
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
  } else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    status = 409;
    body = { code: 'CONFLICT', message: 'Já existe um registro com esses dados' };
  }

  const log = req.log || logger;
  if (status >= 500) log.error({ err, requestId: req.id }, 'erro não tratado');
  else log.warn({ code: body.code, status, requestId: req.id }, body.message);

  res.status(status).json({ error: { ...body, requestId: req.id } });
}
