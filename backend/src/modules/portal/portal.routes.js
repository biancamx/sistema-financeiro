import { Router } from 'express';
import { getParticipantPortal } from './portal.service.js';

export function portalRoutes() {
  const router = Router();
  router.get('/:token', async (req, res, next) => {
    const { token } = req.params;
    if (!/^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{6,10}$/.test(token)) {
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
