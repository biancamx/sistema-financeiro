import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

// Camada "Security & RLS": cabeçalhos seguros, CORS restrito e checagem de Origin em escritas.
export const securityHeaders = helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'],
    },
  },
});

export function isAllowedOrigin(origin) {
  if (!origin || env.frontendUrls.includes(origin)) return true;
  if (env.nodeEnv !== 'development') return false;

  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export const corsPolicy = cors({
  origin(origin, cb) {
    cb(null, isAllowedOrigin(origin));
  },
  credentials: true,
});

/** Defesa extra contra CSRF: se vier Origin em uma escrita, ele precisa ser o do front. */
export function originCheck(req, _res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const origin = req.headers.origin;
  const googleCredentialCallback = req.method === 'POST'
    && req.path === '/api/auth/google/callback';
  if (googleCredentialCallback) return next();
  if (!safe && origin && !isAllowedOrigin(origin)) {
    req.log?.warn({ origin }, 'Origem de escrita bloqueada');
    return next(forbidden('Origem não permitida'));
  }
  next();
}

export function setupSecurity(app) {
  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(originCheck);
}
