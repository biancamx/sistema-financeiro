import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AppError, unauthorized } from '../lib/errors.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';

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
      decoded = jwt.verify(token, env.jwtSecret);
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
      const user = await User.findById(userId).select('_id name email avatar status role');
      if (!user) {
        return next(unauthorized('Usuário não encontrado'));
      }

      if (env.adminEmail && user.email.toLowerCase() === env.adminEmail
        && (user.role !== 'admin' || user.status !== 'active')) {
        user.role = 'admin';
        user.status = 'active';
        await user.save();
      }

      req.user = {
        _id: user._id,
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        avatar: user.avatar || null,
        status: user.status || 'pending',
        role: user.role || 'user',
      };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireActiveAccount() {
  return (req, _res, next) => {
    if (req.user.status !== 'active') {
      const message = req.user.status === 'blocked'
        ? 'Esta conta está bloqueada. Entre em contato com o administrador.'
        : 'Sua conta aguarda aprovação do administrador.';
      return next(new AppError(403, 'ACCOUNT_PENDING', message));
    }
    return next();
  };
}

export function requireAdmin() {
  return (req, _res, next) => {
    if (req.user.role !== 'admin') {
      return next(new AppError(403, 'FORBIDDEN', 'Apenas administradores podem acessar este recurso.'));
    }
    return next();
  };
}
