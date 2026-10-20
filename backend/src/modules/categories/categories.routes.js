import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';

const body = z.object({ name: z.string().trim().min(1).max(80) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

export function categoriesRoutes(db) {
  const r = Router();
  r.get('/', (req, res) => {
    res.json({ data: db.prepare('SELECT id, name FROM categories WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(req.user.id) });
  });
  r.post('/', validate({ body }), (req, res) => {
    const id = db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(req.user.id, req.body.name).lastInsertRowid;
    res.status(201).json({ data: { id: Number(id), name: req.body.name } });
  });
  r.put('/:id', validate({ params: idParam, body }), (req, res) => {
    const info = db.prepare('UPDATE categories SET name = ? WHERE id = ? AND user_id = ?').run(req.body.name, req.params.id, req.user.id);
    if (!info.changes) throw notFound('Categoria não encontrada');
    res.json({ data: { id: req.params.id, name: req.body.name } });
  });
  r.delete('/:id', validate({ params: idParam }), (req, res) => {
    const info = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!info.changes) throw notFound('Categoria não encontrada');
    res.status(204).end();
  });
  return r;
}
