import { randomUUID } from 'node:crypto';
import { PushDelivery } from '../../models/PushDelivery.js';
import { PushSubscription } from '../../models/PushSubscription.js';
import { User } from '../../models/User.js';
import { getSystemAlerts } from '../reminders/alerts.service.js';
import { sendPushToUser } from './push.service.js';

const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

async function claimDelivery(userId, alert) {
  const lockId = randomUUID();
  const staleLock = new Date(Date.now() - LOCK_TIMEOUT_MS);
  try {
    const delivery = await PushDelivery.findOneAndUpdate(
      {
        userId,
        alertId: alert.id,
        alertStatus: alert.status,
        $or: [
          { state: 'pending' },
          { state: 'sending', lockedAt: { $lt: staleLock } },
        ],
      },
      {
        $set: { state: 'sending', lockId, lockedAt: new Date() },
        $setOnInsert: { userId, alertId: alert.id, alertStatus: alert.status },
      },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return delivery?.lockId === lockId ? lockId : null;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

async function finishDelivery(userId, alert, lockId, sent) {
  await PushDelivery.updateOne(
    { userId, alertId: alert.id, alertStatus: alert.status, state: 'sending', lockId },
    {
      $set: {
        state: sent ? 'sent' : 'pending',
        sentAt: sent ? new Date() : null,
        lockId: null,
        lockedAt: null,
      },
    },
  );
}

export async function sendDueAlerts(now = new Date()) {
  const subscribedUserIds = await PushSubscription.distinct('userId');
  const users = await User.find({ _id: { $in: subscribedUserIds }, status: 'active' }).select('_id').lean();
  const result = {
    users: users.length,
    alerts: 0,
    sent: 0,
    skipped: 0,
    expiredSubscriptions: 0,
    failedSubscriptions: 0,
  };

  for (const user of users) {
    const { alerts } = await getSystemAlerts(user._id, now);
    const dueAlerts = alerts.filter((alert) =>
      alert.type === 'card_invoice' && ['today', 'overdue'].includes(alert.status),
    );
    for (const alert of dueAlerts) {
      result.alerts += 1;
      const lockId = await claimDelivery(user._id, alert);
      if (!lockId) {
        result.skipped += 1;
        continue;
      }

      const delivery = await sendPushToUser(user._id, {
        title: alert.title,
        body: alert.description,
        url: alert.link || '/cartoes',
        tag: `${alert.id}-${alert.status}`,
      });
      await finishDelivery(user._id, alert, lockId, delivery.sent > 0);
      if (delivery.sent > 0) result.sent += 1;
      result.expiredSubscriptions += delivery.expired;
      result.failedSubscriptions += delivery.failed;
    }
  }

  return result;
}

export async function sendTestPush(userId) {
  return sendPushToUser(userId, {
    title: 'Notificação de teste',
    body: 'As notificações do Caderno de Contas estão funcionando neste dispositivo.',
    url: '/configuracoes',
    tag: 'push-test',
  });
}
