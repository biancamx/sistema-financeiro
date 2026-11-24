import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { getSessionToken, requireAuth, requireRecentAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { AuthSession } from '../../models/AuthSession.js';
import { recordAuditEvent } from '../../lib/auditEvent.js';
import { User } from '../../models/User.js';
import { SecurityAlert } from '../../models/SecurityAlert.js';
import { raiseLoginFailureAlerts, securitySourceKey } from '../../lib/securityAlerts.js';
import {
  generateToken,
  getOrCreateDemoUser,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  verifySessionToken,
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
const googleCredentialBody = z.object({
  credential: z.string().min(1).max(8192),
});
const googleCallbackBody = googleCredentialBody.extend({
  g_csrf_token: z.string().max(1024).optional(),
  select_by: z.string().max(40).optional(),
  clientId: z.string().max(256).optional(),
  client_id: z.string().max(256).optional(),
});
const sessionParams = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Sessão inválida'),
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

function googleLoginRedirectUrl(failed = false) {
  const baseUrl = env.isProd ? 'https://login.invalid' : (env.frontendUrls[0] || 'http://localhost:5173');
  const url = new URL('/login', baseUrl);
  if (failed) url.searchParams.set('google_error', 'failed');
  return env.isProd ? `${url.pathname}${url.search}` : url.toString();
}

function logGoogleAuthFailure(req, error, fallbackStage) {
  const fields = {
    stage: error.googleAuthStage || fallbackStage,
    errorName: error.googleAuthCauseName || error.name,
    requestId: req.id,
  };
  const errorCode = error.googleAuthCauseCode || (error instanceof AppError ? error.code : undefined);
  if (errorCode) fields.errorCode = errorCode;
  if (error.googleAuthCauseStatus) fields.upstreamStatus = error.googleAuthCauseStatus;

  if (error instanceof AppError && error.status < 500) {
    req.log?.warn(fields, 'Google sign-in rejected');
  } else {
    req.log?.error(fields, 'Google sign-in failed');
  }
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
    await recordAuditEvent({
      eventType: 'auth.account.registered',
      actorUserId: user.id,
      targetUserId: user.id,
      requestId: req.id,
    });
    setSessionCookie(res, token);
    res.status(201).json({ data: { user } });
  }));

  router.post('/login', authLimiter, validate({ body: loginBody }), asyncHandler(async (req, res) => {
    let result;
    try {
      result = await loginWithEmail(req.body.email, req.body.password);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        const sourceKey = securitySourceKey(req.ip);
        const email = req.body.email.toLowerCase().trim();
        const target = await User.findOne({ email }, '_id');
        await recordAuditEvent({
          eventType: 'auth.login.failed',
          targetUserId: target?._id || null,
          sourceKey,
          requestId: req.id,
        });
        await raiseLoginFailureAlerts({ sourceKey, targetUserId: target?._id, requestId: req.id });
      }
      throw error;
    }
    const { user, token } = result;
    await recordAuditEvent({
      eventType: 'auth.login.succeeded',
      actorUserId: user.id,
      targetUserId: user.id,
      requestId: req.id,
    });
    setSessionCookie(res, token);
    res.json({ data: { user } });
  }));

  // Login com Google
  router.post('/google', authLimiter, validate({ body: googleCredentialBody }), async (req, res, next) => {
    let stage = 'authenticate_google_user';
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'Token do Google obrigatório' });
      }

      if (!env.googleClientId) {
        return res.status(501).json({ error: 'Login com Google não está configurado' });
      }

      const { token, user } = await loginWithGoogle(credential);
      stage = 'record_google_login_audit';
      await recordAuditEvent({
        eventType: 'auth.login.succeeded',
        actorUserId: user.id,
        targetUserId: user.id,
        requestId: req.id,
      });

      stage = 'set_google_session_cookie';
      setSessionCookie(res, token);

      res.json({ data: { user } });
    } catch (err) {
      logGoogleAuthFailure(req, err, stage);
      if (err instanceof AppError) return next(err);
      return next(new AppError(401, 'GOOGLE_AUTH_FAILED', 'Não foi possível concluir o login com Google.'));
    }
  });

  router.post('/google/callback', authLimiter, validate({ body: googleCallbackBody }), async (req, res) => {
    if (!hasValidGoogleCsrfToken(req)) {
      req.log?.warn({ stage: 'validate_google_csrf', requestId: req.id }, 'Google sign-in rejected');
      return res.redirect(303, googleLoginRedirectUrl(true));
    }
    if (!req.body?.credential) {
      return res.status(400).json({ error: 'Token do Google obrigatório' });
    }
    if (!env.googleClientId) {
      return res.status(501).json({ error: 'Login com Google não está configurado' });
    }

    let stage = 'authenticate_google_user';
    try {
      const { token, user } = await loginWithGoogle(req.body.credential);
      stage = 'record_google_login_audit';
      await recordAuditEvent({
        eventType: 'auth.login.succeeded',
        actorUserId: user.id,
        targetUserId: user.id,
        requestId: req.id,
      });
      stage = 'set_google_session_cookie';
      setSessionCookie(res, token);
      stage = 'redirect_after_google_login';
      return res.redirect(303, googleLoginRedirectUrl());
    } catch (err) {
      logGoogleAuthFailure(req, err, stage);
      return res.redirect(303, googleLoginRedirectUrl(true));
    }
  });

  // Usuário autenticado
  router.get('/me', requireAuth(), (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: { user: req.user } });
  });

  // Logout
  router.post('/logout', async (req, res, next) => {
    const token = getSessionToken(req);
    if (token) {
      try {
        const claims = verifySessionToken(token);
        await AuthSession.updateOne(
          { userId: claims.sub, tokenId: claims.jti, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
        await recordAuditEvent({
          eventType: 'auth.session.revoked',
          actorUserId: claims.sub,
          targetUserId: claims.sub,
          targetId: claims.jti,
          requestId: req.id,
        });
      } catch (error) {
        if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') {
          return next(error);
        }
      }
    }
    for (const name of ['caderno_token', 'fin_token']) {
      res.clearCookie(name, sessionCookieOptions);
      res.clearCookie(name, { ...sessionCookieOptions, path: '/api/auth' });
    }
    res.json({ message: 'Desconectado com sucesso' });
  });

  router.get('/sessions', requireAuth(), async (req, res, next) => {
    try {
      const sessions = await AuthSession.find({
        userId: req.user._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).select('tokenId createdAt expiresAt').sort({ createdAt: -1 }).lean();
      res.set('Cache-Control', 'no-store');
      res.json({
        data: sessions.map((session) => ({
          id: session.tokenId,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          current: session.tokenId === req.authSessionId,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/security-alerts', requireAuth(), asyncHandler(async (req, res) => {
    const alerts = await SecurityAlert.find({ userId: req.user._id })
      .select('alertType readAt createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.set('Cache-Control', 'no-store').json({ data: alerts });
  }));

  router.patch('/security-alerts/read', requireAuth(), asyncHandler(async (req, res) => {
    await SecurityAlert.updateMany(
      { userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.status(204).end();
  }));

  router.delete('/sessions/:sessionId', requireAuth(), requireRecentAuth(), validate({ params: sessionParams }), async (req, res, next) => {
    try {
      const result = await AuthSession.updateOne(
        {
          userId: req.user._id,
          tokenId: req.params.sessionId,
          revokedAt: null,
        },
        { $set: { revokedAt: new Date() } },
      );
      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sessão não encontrada.' } });
      }
      await recordAuditEvent({
        eventType: 'auth.session.revoked',
        actorUserId: req.user._id,
        targetUserId: req.user._id,
        targetId: req.params.sessionId,
        requestId: req.id,
      });
      req.log?.info({ userId: req.user.id }, 'User revoked a session');
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout-all', requireAuth(), requireRecentAuth(), async (req, res, next) => {
    try {
      await AuthSession.updateMany(
        { userId: req.user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      await recordAuditEvent({
        eventType: 'auth.sessions.revoked',
        actorUserId: req.user._id,
        targetUserId: req.user._id,
        requestId: req.id,
      });
      for (const name of ['caderno_token', 'fin_token']) {
        res.clearCookie(name, sessionCookieOptions);
        res.clearCookie(name, { ...sessionCookieOptions, path: '/api/auth' });
      }
      return res.json({ message: 'Todas as sessões foram encerradas.' });
    } catch (error) {
      return next(error);
    }
  });

  // Modo local
  router.post('/local', async (req, res, next) => {
    try {
      if (!env.localLoginEnabled) {
        return res.status(404).json({ error: 'Rota não encontrada' });
      }
      const user = await getOrCreateDemoUser();
      const token = await generateToken(user);
      setSessionCookie(res, token);
      res.json({ data: { user } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}