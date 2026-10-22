import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
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

function setSessionCookie(res, token) {
  res.cookie('caderno_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function authRoutes() {
  const router = Router();

  // ROTA DE CONFIGURAÇÃO PÚBLICA (Consumida pelo LoginPage)
  router.get('/config', (req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
    const isLocalAllowed = process.env.NODE_ENV !== 'production';

    res.json({
      google: {
        enabled: Boolean(googleClientId),
        clientId: googleClientId,
      },
      local: {
        enabled: isLocalAllowed,
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
  router.post('/google', authLimiter, async (req, res) => {
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
      console.error('Erro no login Google:', err.message);
      res.status(401).json({ error: 'Falha ao autenticar com o Google' });
    }
  });

  // Usuário autenticado
  router.get('/me', requireAuth(), (req, res) => {
    res.json({ data: { user: req.user } });
  });

  // Logout
  router.post('/logout', (req, res) => {
    res.clearCookie('caderno_token');
    res.json({ message: 'Desconectado com sucesso' });
  });

  // Modo local
  router.post('/local', async (req, res, next) => {
    try {
      if (process.env.NODE_ENV === 'production' && process.env.ENABLE_LOCAL_LOGIN !== 'true') {
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