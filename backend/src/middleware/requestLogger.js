import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';

export function redactPortalToken(url) {
  const portalPath = '/api/portal/';
  if (!url.startsWith(portalPath)) return url;

  const queryIndex = url.indexOf('?');
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : url.slice(queryIndex);
  const tokenStart = portalPath.length;
  const tokenEnd = pathname.indexOf('/', tokenStart);
  const tokenPathEnd = tokenEnd === -1 ? pathname.length : tokenEnd;

  if (tokenPathEnd === tokenStart) return url;
  return `${pathname.slice(0, tokenStart)}[REDACTED]${pathname.slice(tokenPathEnd)}${query}`;
}

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  serializers: {
    req: (r) => ({ id: r.id, method: r.method, url: redactPortalToken(r.url) }),
    res: (r) => ({ statusCode: r.statusCode }),
  },
  autoLogging: { ignore: (req) => req.url === '/api/system/health' },
});
