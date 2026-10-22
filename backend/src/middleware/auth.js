import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { unauthorized } from '../lib/errors.js';
import { User } from '../models/User.js';

export function requireAuth() {
  return async (req, res, next) => {
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

    const userId = decoded.sub || decoded.id;
    if (typeof userId !== 'string' || !mongoose.isValidObjectId(userId)) {
      return next(unauthorized('Sessão inválida'));
    }

    try {
      const user = await User.findById(userId).select('_id name email avatar');
      if (!user) {
        return next(unauthorized('Usuário não encontrado'));
      }

      req.user = {
        _id: user._id,
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        avatar: user.avatar || null,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
