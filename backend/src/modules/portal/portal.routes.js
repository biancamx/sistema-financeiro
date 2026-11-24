import { Router } from 'express';
import { portalLimiter } from '../../middleware/rateLimit.js';
import { getParticipantPortal } from './portal.service.js';
import { LEGACY_SHARE_TOKEN_PATTERN } from '../../models/Person.js';

export const PORTAL_TOKEN_PATTERN = /^(?:[A-Za-z0-9_-]{43}|[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{6,64})$/;

export function portalRoutes() {
  const router = Router();
  router.get('/:token', portalLimiter, async (req, res, next) => {
    const { token } = req.params;
    if (!PORTAL_TOKEN_PATTERN.test(token) && !LEGACY_SHARE_TOKEN_PATTERN.test(token)) {
      res.set('Cache-Control', 'no-store').status(404).json({ error: { message: 'Portal não encontrado' } });
      return;
    }

    try {
      const data = await getParticipantPortal(token);
      res.set('Cache-Control', 'no-store');
      if (!data) {
        res.status(404).json({ error: { message: 'Portal não encontrado' } });
        return;
      }
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
