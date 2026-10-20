import { Router } from 'express';
import jwt from 'jsonwebtoken';
import {
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  getCurrentUser,
} from './auth.service.js';

export function authRoutes(db) {
  const router = Router();

  // Configuração pública do Auth para o Frontend (ativa botão Google)
  router.get('/config', (_req, res) => {
    res.json({
      local: { enabled: false },
      google: {
        enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
        clientId: process.env.GOOGLE_CLIENT_ID || '',
      },
    });
  });

  // Retorna os dados do usuário autenticado pela sessão (cookie ou bearer)
  router.get('/me', async (req, res) => {
    try {
      const token =
        req.cookies?.['caderno_token'] ||
        req.cookies?.['fin_token'] ||
        (req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : null);

      if (!token) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      const jwtSecret = process.env.JWT_SECRET || 'REDACTED_SECRET';
      const payload = jwt.verify(token, jwtSecret);
      const user = await getCurrentUser(payload.id);

      if (!user) {
        return res.status(401).json({ error: 'Usuário não encontrado' });
      }

      res.json({ data: { user }, user });
    } catch (err) {
      res.status(401).json({ error: 'Sessão inválida ou expirada' });
    }
  });

  // Encerra a sessão removendo os cookies
  router.post('/logout', (_req, res) => {
    res.clearCookie('caderno_token', { path: '/' });
    res.clearCookie('fin_token', { path: '/' });
    res.status(204).end();
  });

  // 1. Rota de Login com Google integrada ao Mongoose
  router.post('/google', async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'Token do Google é obrigatório' });
      }

      const { token, user } = await loginWithGoogle(credential);

      // Salva o cookie de sessão seguro
      res.cookie('caderno_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
      });

      // Salva cookie secundário para compatibilidade
      res.cookie('fin_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json({ data: { user }, user });
    } catch (err) {
      console.error('Erro no login com Google:', err.message);
      res.status(401).json({ error: 'Falha na autenticação com o Google' });
    }
  });

  // Login tradicional
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
      }

      const { token, user } = await loginWithEmail(email, password);

      res.cookie('caderno_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json({ data: { user }, user });
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message });
    }
  });

  // Cadastro tradicional
  router.post('/register', async (req, res) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Preencha todos os campos' });
      }

      const { token, user } = await registerWithEmail(name, email, password);

      res.cookie('caderno_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.status(201).json({ data: { user }, user });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
