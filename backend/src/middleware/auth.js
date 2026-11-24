import mongoose from 'mongoose';
import { AppError, unauthorized } from '../lib/errors.js';
import { AuthSession } from '../models/AuthSession.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { verifySessionToken } from '../modules/auth/auth.service.js';
import { recordAuditEvent } from '../lib/auditEvent.js';
import {
  raiseRevokedSessionReuseAlert,
  raiseSecurityAlerts,
  securitySourceKey,
} from '../lib/securityAlerts.js';

export function getSessionToken(req) {
  return req.cookies?.caderno_token
    || req.cookies?.fin_token
    || (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
}

export function requireAuth() {
  return async (req, res, next) => {
    const token = getSessionToken(req);

    if (!token) {
      return next(unauthorized());
    }

    let decoded;
    try {
      decoded = verifySessionToken(token);
    } catch (err) {
      if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
        return next(unauthorized('Sessão expirada ou inválida'));
      }
      return next(err);
    }

    const userId = decoded.sub;
    if (!mongoose.isValidObjectId(userId)) {
      return next(unauthorized('Sessão inválida'));
    }

    try {
      const session = await AuthSession.findOne({
        userId,
        tokenId: decoded.jti,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).select('_id').lean();
      if (!session) {
        const revokedSession = await AuthSession.findOne({ userId, tokenId: decoded.jti, revokedAt: { $ne: null } })
          .select('_id')
          .lean();
        if (revokedSession) {
          void recordRevokedSessionReuse(req, userId, decoded.jti).catch((error) => {
            req.log?.error({ errorName: error.name, requestId: req.id }, 'Falha ao registrar reutilização de sessão revogada');
          });
        }
        return next(unauthorized('Sessão revogada ou expirada'));
      }

      const user = await User.findById(userId).select('_id name email avatar status role googleId');
      if (!user) {
        return next(unauthorized('Usuário não encontrado'));
      }

      if (env.adminEmail && user.email.toLowerCase() === env.adminEmail) {
        if (user.googleId && (user.role !== 'admin' || user.status !== 'active')) {
          const previousRole = user.role;
          const previousStatus = user.status;
          user.role = 'admin';
          user.status = 'active';
          await user.save();
          await recordAuditEvent({
            eventType: 'admin.role_changed',
            targetUserId: user._id,
            targetId: user._id.toString(),
            previousRole,
            newRole: user.role,
            previousStatus,
            newStatus: user.status,
          });
          await raiseSecurityAlerts({
            alertType: 'admin_account_change',
            userIds: [user._id],
            dedupeId: `configured-admin:${user._id}:${Date.now()}`,
            requestId: req.id,
          });
        } else if (!user.googleId && user.role === 'admin') {
          const previousRole = user.role;
          const previousStatus = user.status;
          user.role = 'user';
          user.status = 'pending';
          await user.save();
          await recordAuditEvent({
            eventType: 'admin.role_changed',
            targetUserId: user._id,
            targetId: user._id.toString(),
            previousRole,
            newRole: user.role,
            previousStatus,
            newStatus: user.status,
          });
          await raiseSecurityAlerts({
            alertType: 'admin_account_change',
            userIds: [user._id],
            dedupeId: `configured-admin:${user._id}:${Date.now()}`,
            requestId: req.id,
          });
        }
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
      req.authSessionId = decoded.jti;
      req.authIssuedAt = decoded.iat;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

async function recordRevokedSessionReuse(req, userId, tokenId) {
  await raiseRevokedSessionReuseAlert({
    userId,
    tokenId,
    sourceKey: securitySourceKey(req.ip),
    requestId: req.id,
  });
}

export function requireRecentAuth(maxAgeSeconds = 5 * 60) {
  return (req, _res, next) => {
    const now = Math.floor(Date.now() / 1000);
    const age = now - req.authIssuedAt;
    if (!Number.isInteger(req.authIssuedAt) || age < 0 || age > maxAgeSeconds) {
      return next(new AppError(
        403,
        'REAUTH_REQUIRED',
        'Entre novamente para confirmar sua identidade antes de concluir esta operação.',
      ));
    }
    return next();
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
