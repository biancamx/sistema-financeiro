import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler, AppError, notFound } from '../../lib/errors.js';
import { requireAdmin, requireRecentAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { User } from '../../models/User.js';
import { AuthSession } from '../../models/AuthSession.js';
import { AuditEvent } from '../../models/AuditEvent.js';
import { recordAuditEvent } from '../../lib/auditEvent.js';
import { raiseSecurityAlerts } from '../../lib/securityAlerts.js';

const paramsSchema = z.object({
  userId: z.string().regex(/^[\da-f]{24}$/i, 'ID de usuário inválido'),
});

export function adminRoutes() {
  const router = Router();
  router.use(requireAdmin());

  router.get('/users', asyncHandler(async (_req, res) => {
    const users = await User.find()
      .select('_id name email role status provider createdAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ data: users.map((user) => ({
      ...user,
      id: String(user._id),
      role: user.role || 'user',
      status: user.status || 'pending',
    })) });
  }));

  router.get('/audit-events', validate({
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
  }), asyncHandler(async (req, res) => {
    const { limit } = req.query;
    const events = await AuditEvent.find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    res.set('Cache-Control', 'no-store').json({ data: events });
  }));

  router.patch('/users/:userId', validate({ params: paramsSchema, body: z.object({
    status: z.enum(['active', 'pending', 'blocked']),
  }) }), requireRecentAuth(), asyncHandler(async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) throw new AppError(400, 'BAD_REQUEST', 'ID de usuário inválido');
    if (userId === req.user.id) {
      throw new AppError(400, 'BAD_REQUEST', 'Você não pode alterar o status da própria conta.');
    }

    const user = await User.findById(userId).select('_id name email role status provider createdAt');
    if (!user) throw notFound('Usuário não encontrado');
    if (user.role === 'admin') {
      throw new AppError(400, 'BAD_REQUEST', 'O status de outro administrador não pode ser alterado por esta tela.');
    }

    const previousStatus = user.status;
    if (req.body.status !== 'active') {
      await AuthSession.updateMany(
        { userId: user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }
    user.status = req.body.status;
    await user.save();
    await recordAuditEvent({
      eventType: 'admin.user_status_changed',
      actorUserId: req.user._id,
      targetUserId: user._id,
      targetId: user._id.toString(),
      requestId: req.id,
      previousStatus,
      newStatus: user.status,
    });
    await raiseSecurityAlerts({
      alertType: 'admin_account_change',
      userIds: [user._id],
      dedupeId: req.id,
      requestId: req.id,
    });
    req.log?.info({
      actorUserId: req.user.id,
      targetUserId: user._id.toString(),
      previousStatus,
      status: user.status,
    }, 'Admin changed account status');
    res.json({ data: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      provider: user.provider,
      createdAt: user.createdAt,
    } });
  }));

  return router;
}
