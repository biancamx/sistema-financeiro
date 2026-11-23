import { sendNotification, setVapidDetails } from 'web-push';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { PushSubscription } from '../../models/PushSubscription.js';

let vapidConfigured = false;
export const webPushClient = { sendNotification, setVapidDetails };

export function isPushConfigured() {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

export function getVapidPublicKey() {
  if (!isPushConfigured()) {
    throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Notificações push não estão configuradas no servidor.');
  }
  return env.vapidPublicKey;
}

function configureVapid() {
  if (!isPushConfigured()) {
    throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Notificações push não estão configuradas no servidor. Configure VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no deploy.');
  }
  if (!/^mailto:/i.test(env.vapidSubject) && !/^https?:\/\//i.test(env.vapidSubject)) {
    throw new AppError(503, 'VAPID_SUBJECT_INVALID', 'O VAPID_SUBJECT está inválido no servidor. Use mailto:email ou uma URL HTTPS.');
  }
  if (vapidConfigured) return;
  webPushClient.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  vapidConfigured = true;
}

export async function sendPushToUser(userId, payload) {
  const subscriptions = await PushSubscription.find({ userId })
    .select('+keys.p256dh +keys.auth')
    .lean();
  if (!subscriptions.length) return { attempted: 0, sent: 0, expired: 0, failed: 0 };

  configureVapid();
  let sent = 0;
  let expired = 0;
  let failed = 0;
  const notification = JSON.stringify(payload);

  for (const subscription of subscriptions) {
    try {
      await webPushClient.sendNotification({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      }, notification, { TTL: 60 * 60, urgency: 'high' });
      sent += 1;
    } catch (error) {
      if ([404, 410].includes(Number(error.statusCode))) {
        await PushSubscription.deleteOne({ _id: subscription._id, userId });
        expired += 1;
      } else {
        failed += 1;
        logger.warn({ statusCode: Number(error.statusCode) || null }, 'Falha ao enviar uma notificação push.');
      }
    }
  }

  return { attempted: subscriptions.length, sent, expired, failed };
}
