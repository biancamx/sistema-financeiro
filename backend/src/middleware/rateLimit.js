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

const userKey = (req) => req.user.id;

export const assistantLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: userKey,
  message: msg('Limite de uso do assistente atingido. Aguarde alguns minutos.'),
});

export const importPreviewLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: userKey,
  message: msg('Limite de prévias de importação atingido. Aguarde alguns minutos.'),
});

export const portalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: msg('Limite de consultas ao portal atingido. Aguarde alguns minutos.'),
});

export const clientLogLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 20, message: msg('Limite de logs atingido.') });
