import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { processUserMessage } from './assistant.service.js';

const historyItem = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(4000).optional(),
  content: z.string().max(4000).optional(),
}).refine((item) => typeof item.text === 'string' || typeof item.content === 'string', {
  message: 'Cada mensagem do histórico deve conter texto.',
});

const chatBody = z.object({
  message: z.string().trim().min(1, 'A mensagem é obrigatória.').max(4000),
  history: z.array(historyItem).max(40).default([]),
});

export function assistantRoutes() {
  const router = Router();

  router.post('/chat', validate({ body: chatBody }), asyncHandler(async (req, res) => {
    const result = await processUserMessage({
      message: req.body.message,
      history: req.body.history,
      userId: req.user.id,
    });
    res.json(result);
  }));

  return router;
}
