import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';

const body = z.object({ name: z.string().trim().min(1).max(80), day: z.coerce.number().int().min(1).max(31), month: z.coerce.number().int().min(1).max(12) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

export function birthdaysRoutes(db) {
  const r = Router();
  r.get('/', (req, res) => {
    res.json({ data: db.prepare('SELECT id, name, day, month, person_id AS personId FROM birthdays WHERE user_id = ? ORDER BY month, day').all(req.user.id) });
  });
  r.post('/', validate({ body }), (req, res) => {
    const { name, day, month } = req.body;
    const id = db.prepare('INSERT INTO birthdays (user_id, name, day, month) VALUES (?,?,?,?)').run(req.user.id, name, day, month).lastInsertRowid;
    res.status(201).json({ data: { id: Number(id), name, day, month } });
  });
  r.put('/:id', validate({ params: idParam, body }), (req, res) => {
    const { name, day, month } = req.body;
    const info = db.prepare('UPDATE birthdays SET name=?, day=?, month=? WHERE id=? AND user_id=?').run(name, day, month, req.params.id, req.user.id);
    if (!info.changes) throw notFound('Aniversário não encontrado');
    res.json({ data: { id: req.params.id, name, day, month } });
  });
  r.delete('/:id', validate({ params: idParam }), (req, res) => {
    const birthday = db.prepare('SELECT person_id AS personId FROM birthdays WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!birthday) throw notFound('Aniversário não encontrado');
    db.transaction(() => {
      if (birthday.personId) {
        db.prepare('UPDATE people SET birth_date = NULL WHERE id = ? AND user_id = ?').run(birthday.personId, req.user.id);
      }
      db.prepare('DELETE FROM birthdays WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    })();
    res.status(204).end();
  });
  return r;
}
