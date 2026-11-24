import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import { SecurityAlert } from '../models/SecurityAlert.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { User } from '../models/User.js';
import { logger } from './logger.js';
import { sendPushToUser } from '../modules/push/push.service.js';

export const securityAlertMessages = {
  repeated_login_failures: {
    title: 'Várias tentativas de login',
    body: 'Foram detectadas várias tentativas de login. Verifique a atividade da sua conta.',
  },
  revoked_session_reuse: {
    title: 'Tentativa com sessão encerrada',
    body: 'Uma sessão já encerrada tentou acessar sua conta. Revise as sessões ativas.',
  },
  cross_user_access: {
    title: 'Tentativas de acesso a registros indisponíveis',
    body: 'Houve várias tentativas de acessar registros não disponíveis para esta conta.',
  },
  admin_account_change: {
    title: 'Alteração administrativa na conta',
    body: 'O status ou as permissões da sua conta foram alterados por um administrador.',
  },
};

const windowBucket = (windowMs = 15 * 60 * 1000) => Math.floor(Date.now() / windowMs);

export function securitySourceKey(value) {
  return createHmac('sha256', env.jwtSecret).update(String(value || 'unknown')).digest('hex');
}

export async function activeAdminIds() {
  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').lean();
  return admins.map((admin) => admin._id);
}

export async function raiseSecurityAlerts({ alertType, userIds, dedupeId, requestId }) {
  const message = securityAlertMessages[alertType];
  if (!message) throw new Error('Tipo de alerta de segurança desconhecido.');

  const recipients = [...new Map(userIds.filter(Boolean).map((id) => [String(id), id])).values()];
  let created = 0;
  for (const userId of recipients) {
    const dedupeKey = `${alertType}:${dedupeId}:${String(userId)}`;
    let alert;
    try {
      [alert] = await SecurityAlert.create([{
        userId,
        alertType,
        dedupeKey,
        requestId: requestId || null,
      }]);
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    created += 1;
    void sendPushToUser(userId, {
      ...message,
      url: '/mais/configuracoes',
      tag: `security-${alertType}-${String(userId)}`,
    }).then((result) => {
      if (result.failed) {
        logger.warn({ alertType, failedSubscriptions: result.failed }, 'Falha ao entregar alerta de segurança por Web Push.');
      }
    }).catch((error) => {
      logger.warn({ alertType, errorName: error.name, requestId: requestId || null }, 'Não foi possível enviar alerta de segurança por Web Push.');
    });
  }
  return created;
}

export async function raiseLoginFailureAlerts({ sourceKey, targetUserId, requestId }) {
  const windowMs = 15 * 60 * 1000;
  const failureScope = targetUserId ? { targetUserId } : { sourceKey };
  const attempts = await AuditEvent.countDocuments({
    eventType: 'auth.login.failed',
    ...failureScope,
    createdAt: { $gte: new Date(Date.now() - windowMs) },
  });
  if (attempts < 5) return 0;
  const userIds = [...(targetUserId ? [targetUserId] : []), ...(await activeAdminIds())];
  return raiseSecurityAlerts({
    alertType: 'repeated_login_failures',
    userIds,
    dedupeId: `${targetUserId || sourceKey}:${windowBucket(windowMs)}`,
    requestId,
  });
}

export async function raiseUnavailableRecordAlerts({ actorUserId, sourceKey, requestId }) {
  const windowMs = 15 * 60 * 1000;
  const attempts = await AuditEvent.countDocuments({
    eventType: 'access.denied',
    actorUserId,
    sourceKey,
    createdAt: { $gte: new Date(Date.now() - windowMs) },
  });
  if (attempts < 3) return 0;
  return raiseSecurityAlerts({
    alertType: 'cross_user_access',
    userIds: [actorUserId, ...(await activeAdminIds())],
    dedupeId: `${sourceKey}:${windowBucket(windowMs)}`,
    requestId,
  });
}

export async function raiseRevokedSessionReuseAlert({ userId, tokenId, sourceKey, requestId }) {
  await AuditEvent.create({
    eventType: 'auth.session.reuse_detected',
    targetUserId: userId,
    sourceKey,
    requestId,
  });
  return raiseSecurityAlerts({
    alertType: 'revoked_session_reuse',
    userIds: [userId, ...(await activeAdminIds())],
    dedupeId: `${userId}:${securitySourceKey(tokenId)}`,
    requestId,
  });
}
