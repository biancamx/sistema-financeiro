import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  generateToken,
  getOrCreateDemoUser,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
} from './auth.service.js';

const registerBody = z.object({
  name: z.string().trim().min(1, 'Informe seu nome').max(80, 'O nome deve ter até 80 caracteres'),
  email: z.string().trim().email('Informe um e-mail válido').max(254),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(128),
});
const loginBody = z.object({
  email: z.string().trim().email('Informe um e-mail válido').max(254),
  password: z.string().min(1, 'Informe sua senha').max(128),
});

const sessionCookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'lax' : env.cookieSameSite,
  path: '/',
};

function setSessionCookie(res, token) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number') {
    throw new Error('Token de sessão sem expiração válida');
  }
  res.cookie('caderno_token', token, {
    ...sessionCookieOptions,
    maxAge: Math.max(0, payload.exp * 1000 - Date.now()),
  });
}

function hasValidGoogleCsrfToken(req) {
  const cookieToken = req.cookies?.g_csrf_token;
  const bodyToken = req.body?.g_csrf_token;
  if (typeof cookieToken !== 'string' || typeof bodyToken !== 'string'
    || !cookieToken || cookieToken.length > 1024 || bodyToken.length > 1024) return false;

  const cookieBuffer = Buffer.from(cookieToken);
  const bodyBuffer = Buffer.from(bodyToken);
  return cookieBuffer.length === bodyBuffer.length && timingSafeEqual(cookieBuffer, bodyBuffer);
}

export function authRoutes() {
  const router = Router();

  // ROTA DE CONFIGURAÇÃO PÚBLICA (Consumida pelo LoginPage)
  router.get('/config', (req, res) => {
    const googleClientId = env.googleClientId || null;

    res.json({
      google: {
        enabled: Boolean(googleClientId),
        clientId: googleClientId,
      },
      local: {
        enabled: env.localLoginEnabled,
      },
    });
  });

  router.post('/register', authLimiter, validate({ body: registerBody }), asyncHandler(async (req, res) => {
    const { user, token } = await registerWithEmail(req.body.name, req.body.email, req.body.password);
    setSessionCookie(res, token);
    res.status(201).json({ data: { user } });
  }));

  router.post('/login', authLimiter, validate({ body: loginBody }), asyncHandler(async (req, res) => {
    const { user, token } = await loginWithEmail(req.body.email, req.body.password);
    setSessionCookie(res, token);
    res.json({ data: { user } });
  }));

  // Login com Google
  router.post('/google', authLimiter, async (req, res, next) => {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'Token do Google obrigatório' });
      }

      if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(501).json({ error: 'Login com Google não está configurado' });
      }

      const { token, user } = await loginWithGoogle(credential);

      setSessionCookie(res, token);

      res.json({ data: { user } });
    } catch (err) {
      if (err instanceof AppError) return next(err);
      console.error('Erro no login Google:', err.message);
      res.status(401).json({ error: 'Falha ao autenticar com o Google' });
    }
  });

  router.post('/google/callback', authLimiter, async (req, res, next) => {
    if (!hasValidGoogleCsrfToken(req)) {
      return res.status(403).json({ error: 'Token CSRF do Google inválido' });
    }
    if (!req.body?.credential) {
      return res.status(400).json({ error: 'Token do Google obrigatório' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(501).json({ error: 'Login com Google não está configurado' });
    }

    try {
      const { token } = await loginWithGoogle(req.body.credential);
      setSessionCookie(res, token);
      return res.redirect(303, env.isProd ? '/' : (env.frontendUrls[0] || '/'));
    } catch (err) {
      if (err instanceof AppError) return next(err);
      req.log?.error({ err }, 'Erro no callback de login Google');
      return res.status(401).json({ error: 'Falha ao autenticar com o Google' });
    }
  });

  // Usuário autenticado
  router.get('/me', requireAuth(), (req, res) => {
    res.json({ data: { user: req.user } });
  });

  // Logout
  router.post('/logout', (req, res) => {
    for (const name of ['caderno_token', 'fin_token']) {
      res.clearCookie(name, sessionCookieOptions);
      res.clearCookie(name, { ...sessionCookieOptions, path: '/api/auth' });
    }
    res.json({ message: 'Desconectado com sucesso' });
  });

  // Modo local
  router.post('/local', async (req, res, next) => {
    try {
      if (!env.localLoginEnabled) {
        return res.status(404).json({ error: 'Rota não encontrada' });
      }
      const user = await getOrCreateDemoUser();
      const token = generateToken(user);
      setSessionCookie(res, token);
      res.json({ data: { user } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}