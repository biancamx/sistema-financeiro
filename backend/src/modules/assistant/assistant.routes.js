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

const assistantImage = z.object({
  base64: z.string().min(1).max(11_184_812),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

const chatBody = z.object({
  message: z.string().trim().max(4000).default(''),
  image: assistantImage.optional(),
  history: z.array(historyItem).max(40).default([]),
}).refine((body) => body.message.length > 0 || Boolean(body.image), {
  message: 'Informe uma mensagem ou envie uma imagem.',
});

export function assistantRoutes() {
  const router = Router();

  router.post('/chat', validate({ body: chatBody }), asyncHandler(async (req, res) => {
    const result = await processUserMessage({
      message: req.body.message,
      image: req.body.image,
      history: req.body.history,
      userId: req.user.id,
    });
    res.json(result);
  }));

  return router;
}
