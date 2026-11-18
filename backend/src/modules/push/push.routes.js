import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { PushSubscription } from '../../models/PushSubscription.js';
import { getVapidPublicKey, isPushConfigured } from './push.service.js';

const subscriptionBody = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(256),
    }),
    expirationTime: z.number().nullable().optional(),
  }),
  userAgent: z.string().max(512).optional(),
});

const removeSubscriptionBody = z.object({
  endpoint: z.string().url().max(2048),
});

export function pushRoutes() {
  const router = Router();

  router.get('/vapid-public-key', asyncHandler(async (_req, res) => {
    res.json({ data: { publicKey: getVapidPublicKey() } });
  }));

  router.post('/subscriptions', validate({ body: subscriptionBody }), asyncHandler(async (req, res) => {
    if (!isPushConfigured()) {
      return res.status(503).json({
        error: { code: 'PUSH_NOT_CONFIGURED', message: 'Notificações push não estão configuradas no servidor.' },
      });
    }

    const { subscription, userAgent = '' } = req.body;
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          userId: req.user._id,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          userAgent,
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ success: true });
  }));

  router.delete('/subscriptions', validate({ body: removeSubscriptionBody }), asyncHandler(async (req, res) => {
    await PushSubscription.deleteOne({ userId: req.user._id, endpoint: req.body.endpoint });
    res.status(204).end();
  }));

  return router;
}
