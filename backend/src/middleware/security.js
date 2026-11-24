import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

// Camada "Security & RLS": cabeçalhos seguros, CORS restrito e checagem de Origin em escritas.
export const securityHeaders = helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      frameSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'],
      fontSrc: ["'self'"],
      styleSrc: ["'self'"],
      styleSrcElem: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      styleSrcAttr: ["'unsafe-inline'"],
      formAction: ["'self'"],
      ...(env.isProd ? { upgradeInsecureRequests: [] } : {}),
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
  if (safe) return next();

  if (origin && !isAllowedOrigin(origin)) {
    req.log?.warn({ origin }, 'Origem de escrita bloqueada');
    return next(forbidden('Origem não permitida'));
  }

  if (!origin && (req.cookies?.caderno_token || req.cookies?.fin_token)) {
    let refererOrigin;
    try {
      refererOrigin = new URL(req.headers.referer).origin;
    } catch {
      return next(forbidden('A origem da requisição não pôde ser validada'));
    }
    if (!isAllowedOrigin(refererOrigin)) {
      return next(forbidden('Origem não permitida'));
    }
  }

  next();
}

export function setupSecurity(app) {
  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(originCheck);
}
