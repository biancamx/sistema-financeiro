import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { calcRescission } from './rescission.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z
  .object({
    salary: z.coerce.number().positive().max(10_000_000),
    admission: date,
    dismissal: date,
    reason: z.enum(['Sem justa causa', 'Justa causa', 'Pedido de demissão', 'Acordo']),
    notice: z.enum(['Trabalhado', 'Indenizado']),
    fgtsBalance: z.coerce.number().min(0).max(100_000_000),
  })
  .refine((d) => d.dismissal >= d.admission, { message: 'A demissão não pode ser antes da admissão', path: ['dismissal'] });

export function toolsRoutes() {
  const r = Router();
  r.post('/rescission', validate({ body: schema }), (req, res) => res.json({ data: calcRescission(req.body) }));
  return r;
}
