import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  serializers: {
    req: (r) => ({ id: r.id, method: r.method, url: r.url }),
    res: (r) => ({ statusCode: r.statusCode }),
  },
  autoLogging: { ignore: (req) => req.url === '/api/system/health' },
});
