import pino from 'pino';
import { env } from '../config/env.js';

// Camada "Error Tracking & Logs": logs estruturados (JSON em produção, legíveis em dev).
// Para Sentry/Datadog basta enviar o stdout ou plugar um transport do pino aqui.
export const logger = pino({
  level: env.isTest ? 'silent' : env.logLevel,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password'],
  ...(env.isProd || env.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});
