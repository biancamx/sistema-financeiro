import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';
import { User } from '../models/User.js';

export function signToken(user) {
  const secret = process.env.JWT_SECRET || env.jwtSecret || 'REDACTED_SECRET';
  return jwt.sign(
    {
      id: user._id ? user._id.toString() : String(user.id),
      sub: user._id ? user._id.toString() : String(user.id),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    },
    secret,
    { expiresIn: '30d' }
  );
}

export function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/',
  };
  res.cookie('caderno_token', token, cookieOptions);
  res.cookie(env.cookieName, token, cookieOptions);
}

export const clearAuthCookie = (res) => {
  res.clearCookie('caderno_token', { path: '/' });
  res.clearCookie(env.cookieName, { path: '/' });
};

/** Camada "Auth & Permissions": exige usuário válido; tudo que vem depois usa req.user.id */
export function requireAuth(arg1, arg2, arg3) {
  const handler = async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const token =
        req.cookies?.['caderno_token'] ||
        req.cookies?.[env.cookieName] ||
        (header?.startsWith('Bearer ') ? header.slice(7) : null);
      if (!token) throw unauthorized();

      const jwtSecret = process.env.JWT_SECRET || env.jwtSecret || 'REDACTED_SECRET';
      const payload = jwt.verify(token, jwtSecret);
      const userId = payload.id || payload.sub;

      let user = null;
      if (userId) {
        try {
          user = await User.findById(userId).select('-passwordHash').lean();
        } catch {}
      }

      let effectiveId = user._id ? user._id.toString() : user.id;
      const db = arg1 && typeof arg1.prepare === 'function' ? arg1 : null;

      if (db && user?.email) {
        try {
          let sqliteUser = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email);
          if (!sqliteUser) {
            const ins = db.prepare(
              'INSERT INTO users (name, email, picture, google_sub, provider) VALUES (?, ?, ?, ?, ?)'
            ).run(user.name, user.email, user.avatar || null, user.googleId || null, 'google');
            sqliteUser = { id: ins.lastInsertRowid };
          }
          if (sqliteUser?.id) {
            effectiveId = sqliteUser.id;
          }
        } catch (dbErr) {
          console.warn('Falha ao sincronizar usuário no SQLite:', dbErr.message);
        }
      }

      if (!user) throw unauthorized('Usuário não encontrado');
      req.user = {
        id: effectiveId,
        mongoId: user._id ? user._id.toString() : null,
        name: user.name,
        email: user.email,
        avatar: user.avatar || user.picture || null,
        provider: user.googleId ? 'google' : user.provider || 'password',
      };
      next();
    } catch (e) {
      next(
        e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError'
          ? unauthorized('Sessão inválida ou expirada')
          : e
      );
    }
  };

  if (arg1 && arg1.headers) {
    return handler(arg1, arg2, arg3);
  }
  return handler;
}
