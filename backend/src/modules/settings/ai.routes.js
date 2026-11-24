import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  getAiSettings,
  removeAiSettings,
  saveAiSettings,
  setAiConsent,
  testAiProvider,
} from './ai.service.js';

const providerModel = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(100),
});
const apiKeyField = z.string().trim().min(10).max(4096);

export function settingsRoutes() {
  const router = Router();
  router.use(requireAuth());

  router.get('/ai', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await getAiSettings(req.user.id) });
  }));

  router.put('/ai', validate({
    body: providerModel.extend({ apiKey: apiKeyField.optional(), consent: z.boolean() }),
  }), asyncHandler(async (req, res) => {
    const data = await saveAiSettings(req.user.id, req.body);
    res.json({ success: true, data });
  }));

  router.delete('/ai', asyncHandler(async (req, res) => {
    await removeAiSettings(req.user.id);
    res.json({ success: true, data: { configured: false } });
  }));

  router.patch('/ai/consent', validate({
    body: z.object({ consent: z.boolean() }),
  }), asyncHandler(async (req, res) => {
    const data = await setAiConsent(req.user.id, req.body.consent);
    res.json({ success: true, data });
  }));

  router.post('/ai/test', validate({
    body: providerModel.extend({ apiKey: apiKeyField.optional() }),
  }), asyncHandler(async (req, res) => {
    await testAiProvider({ ...req.body, userId: req.user.id });
    res.json({ success: true, data: { valid: true, message: 'A chave foi validada com sucesso.' } });
  }));

  return router;
}
