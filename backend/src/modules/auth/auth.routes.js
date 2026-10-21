import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { loginWithGoogle } from './auth.service.js';

export function authRoutes(db) {
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

  // Login com Google
  router.post('/google', async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'Token do Google obrigatório' });
      }

      if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(501).json({ error: 'Login com Google não está configurado' });
      }

      const { token, user } = await loginWithGoogle(credential);

      // Sincroniza usuário do Google com o SQLite
      const existingInSqlite = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email.toLowerCase());
      if (!existingInSqlite) {
        db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
          .run(user.name, user.email.toLowerCase(), 'GOOGLE_USER');
      }

      res.cookie('caderno_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json({ data: { user } });
    } catch (err) {
      console.error('Erro no login Google:', err.message);
      res.status(401).json({ error: 'Falha ao autenticar com o Google' });
    }
  });

  // Usuário autenticado
  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ data: { user: req.user } });
  });

  // Logout
  router.post('/logout', (req, res) => {
    res.clearCookie('caderno_token');
    res.json({ message: 'Desconectado com sucesso' });
  });

  // Modo local
  router.post('/local', (req, res) => {
    let user = db.prepare("SELECT id, name, email FROM users WHERE email = 'demo@local.dev'").get();
    if (!user) {
      const ins = db.prepare("INSERT INTO users (name, email, password_hash) VALUES ('Usuário Demo', 'demo@local.dev', 'local')").run();
      user = { id: ins.lastInsertRowid, name: 'Usuário Demo', email: 'demo@local.dev' };
    }

    import('jsonwebtoken').then(({ default: jwt }) => {
      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name },
        process.env.JWT_SECRET || 'REDACTED_SECRET',
        { expiresIn: '30d' }
      );

      res.cookie('caderno_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json({ data: { user } });
    });
  });

  return router;
}