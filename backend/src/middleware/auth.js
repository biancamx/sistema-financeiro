import jwt from 'jsonwebtoken';
import { unauthorized } from '../lib/errors.js';

export function requireAuth(db) {
  return (req, res, next) => {
    const token =
      req.cookies?.caderno_token ||
      req.cookies?.fin_token ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

    if (!token) {
      return next(unauthorized());
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'REDACTED_SECRET');
    } catch (err) {
      if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return next(unauthorized('Sessão expirada ou inválida'));
      }
      return next(err);
    }

    if (typeof decoded.email !== 'string' || !decoded.email.trim()) {
      return next(unauthorized('Sessão inválida'));
    }

    try {
      const email = decoded.email.trim().toLowerCase();
      let user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);

      if (!user) {
        const name = decoded.name || 'Usuário';
        const result = db.prepare(`
          INSERT INTO users (name, email, password_hash)
          VALUES (?, ?, 'GOOGLE_USER')
        `).run(name, email);
        user = { id: result.lastInsertRowid, name, email };
      }

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: decoded.avatar || null,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
