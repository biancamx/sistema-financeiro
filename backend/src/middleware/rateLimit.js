import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

// Camada "Rate Limiting"
const base = { standardHeaders: true, legacyHeaders: false };
const msg = (m) => ({ error: { code: 'RATE_LIMITED', message: m } });

export const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimitMax,
  message: msg('Muitas requisições. Aguarde alguns minutos.'),
});

export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: env.authRateLimitMax,
  message: msg('Muitas tentativas de login. Aguarde alguns minutos.'),
});

export const clientLogLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 20, message: msg('Limite de logs atingido.') });
