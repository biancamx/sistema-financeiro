import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../lib/errors.js';
import { User } from '../../models/User.js';
import { sendDueAlerts, sendTestPush } from './pushJobs.service.js';

const testBody = z.object({
  userId: z.string().regex(/^[\da-f]{24}$/i),
});

function requireJobsToken(req, res, next) {
  if (!env.jobsToken) {
    return res.status(503).json({
      error: { code: 'JOBS_NOT_CONFIGURED', message: 'A variável JOBS_TOKEN não está configurada.' },
    });
  }
  const provided = req.get('x-jobs-token') || '';
  const expectedBuffer = Buffer.from(env.jobsToken);
  const providedBuffer = Buffer.from(provided);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token de job inválido.' } });
  }
  return next();
}

export function jobsRoutes() {
  const router = Router();
  router.use(requireJobsToken);

  router.post('/notificar', asyncHandler(async (_req, res) => {
    res.json({ success: true, ...(await sendDueAlerts()) });
  }));

  router.post('/teste', asyncHandler(async (req, res) => {
    const parsed = testBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Informe um userId válido.' },
      });
    }
    const user = await User.findOne({ _id: parsed.data.userId, status: 'active' }).select('_id').lean();
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Usuário ativo não encontrado.' } });
    res.json({ success: true, ...(await sendTestPush(user._id)) });
  }));

  return router;
}
