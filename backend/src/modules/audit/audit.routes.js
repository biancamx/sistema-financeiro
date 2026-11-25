import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AccessAuditLog } from '../../models/AccessAuditLog.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  event: z.enum(['login', 'registration', 'logout']).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
});

export function auditRoutes() {
  const router = Router();

  router.get('/access', validate({ query: querySchema }), asyncHandler(async (req, res) => {
    const { page, limit, event, outcome } = req.query;
    const isAdmin = req.user.role === 'admin';
    const filter = {
      ...(!isAdmin && {
        $or: [
          { userId: req.user._id },
          { email: req.user.email.toLowerCase() },
        ],
      }),
      ...(event && { event }),
      ...(outcome && { outcome }),
    };

    const [events, total] = await Promise.all([
      AccessAuditLog.find(filter)
        .select('_id event outcome userId email provider ipAddress userAgent createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AccessAuditLog.countDocuments(filter),
    ]);

    res.json({
      data: {
        events: events.map((entry) => ({ ...entry, id: String(entry._id) })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        scope: isAdmin ? 'all' : 'account',
      },
    });
  }));

  return router;
}
