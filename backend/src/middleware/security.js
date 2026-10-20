import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

// Camada "Security & RLS": cabeçalhos seguros, CORS restrito e checagem de Origin em escritas.
export const securityHeaders = helmet();

export const corsPolicy = cors({
  origin(origin, cb) {
    if (!origin || env.frontendUrls.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
});

/** Defesa extra contra CSRF: se vier Origin em uma escrita, ele precisa ser o do front. */
export function originCheck(req, _res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const origin = req.headers.origin;
  if (!safe && origin && !env.frontendUrls.includes(origin)) return next(forbidden('Origem não permitida'));
  next();
}
