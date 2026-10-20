import { Router } from 'express';
import { z } from 'zod';
import { conflict, notFound } from '../../lib/errors.js';
import { generateShareToken } from '../../lib/shareToken.js';
import { validate } from '../../middleware/validate.js';

const birthDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento inválida')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Data de nascimento inválida')
  .nullable()
  .optional();

const body = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  birthDate,
  pixKey: z.string().trim().max(120).nullable().optional(),
  avatar: z.string().max(30_000).regex(/^data:image\/jpeg;base64,[A-Za-z\d+/]+=*$/).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

function syncBirthday(db, userId, personId, name, date) {
  const existing = db.prepare('SELECT id FROM birthdays WHERE user_id = ? AND person_id = ?').get(userId, personId);
  if (!date) {
    if (existing) db.prepare('DELETE FROM birthdays WHERE id = ? AND user_id = ?').run(existing.id, userId);
    return;
  }

  const [year, month, day] = date.split('-').map(Number);
  if (existing) {
    db.prepare('UPDATE birthdays SET name = ?, day = ?, month = ? WHERE id = ? AND user_id = ?')
      .run(name, day, month, existing.id, userId);
  } else {
    db.prepare('INSERT INTO birthdays (user_id, name, day, month, person_id) VALUES (?, ?, ?, ?, ?)')
      .run(userId, name, day, month, personId);
  }
}

function personData(db, personId, userId) {
  return db.prepare(
    `SELECT p.id, p.name, p.phone, p.email, p.birth_date, p.pix_key, p.avatar, p.notes, p.share_token,
       (SELECT COUNT(*) FROM purchases WHERE person_id = p.id AND user_id = p.user_id) AS purchases
     FROM people p WHERE p.id = ? AND p.user_id = ?`,
  ).get(personId, userId);
}

export function peopleRoutes(db) {
  const r = Router();
  r.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.phone, p.email, p.birth_date, p.pix_key, p.avatar, p.notes, p.share_token,
          (SELECT COUNT(*) FROM purchases WHERE person_id = p.id AND user_id = p.user_id) AS purchases
         FROM people p WHERE p.user_id = ? ORDER BY p.name COLLATE NOCASE`,
      )
      .all(req.user.id);
    res.json({ data: rows });
  });
  r.post('/', validate({ body }), (req, res) => {
    const values = {
      phone: req.body.phone || null,
      email: req.body.email ? req.body.email.toLowerCase() : null,
      birthDate: req.body.birthDate || null,
      pixKey: req.body.pixKey || null,
      avatar: req.body.avatar || null,
      notes: req.body.notes || null,
    };
    const created = db.transaction(() => {
      const result = db.prepare(
        `INSERT INTO people (user_id, name, phone, email, birth_date, pix_key, avatar, notes, share_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(req.user.id, req.body.name, values.phone, values.email, values.birthDate, values.pixKey, values.avatar, values.notes, generateShareToken(db));
      const personId = Number(result.lastInsertRowid);
      syncBirthday(db, req.user.id, personId, req.body.name, values.birthDate);
      return personData(db, personId, req.user.id);
    })();
    res.status(201).json({ data: created });
  });
  r.put('/:id', validate({ params: idParam, body }), (req, res) => {
    const updated = db.transaction(() => {
      const current = db.prepare('SELECT * FROM people WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!current) throw notFound('Pessoa não encontrada');
      const values = {
        name: req.body.name,
        phone: req.body.phone === undefined ? current.phone : req.body.phone || null,
        email: req.body.email === undefined ? current.email : req.body.email ? req.body.email.toLowerCase() : null,
        birthDate: req.body.birthDate === undefined ? current.birth_date : req.body.birthDate || null,
        pixKey: req.body.pixKey === undefined ? current.pix_key : req.body.pixKey || null,
        avatar: req.body.avatar === undefined ? current.avatar : req.body.avatar || null,
        notes: req.body.notes === undefined ? current.notes : req.body.notes || null,
      };
      db.prepare(
        `UPDATE people SET name = ?, phone = ?, email = ?, birth_date = ?, pix_key = ?, avatar = ?, notes = ?
         WHERE id = ? AND user_id = ?`,
      ).run(values.name, values.phone, values.email, values.birthDate, values.pixKey, values.avatar, values.notes, req.params.id, req.user.id);
      syncBirthday(db, req.user.id, Number(req.params.id), values.name, values.birthDate);
      return personData(db, req.params.id, req.user.id);
    })();
    res.json({ data: updated });
  });
  r.delete('/:id', validate({ params: idParam }), (req, res) => {
    // Gastos de veículo guardam quem pagou/assumiu: apagar a pessoa quebraria o histórico.
    const used = db
      .prepare('SELECT (SELECT COUNT(*) FROM vehicle_expenses WHERE payer_id = ? AND user_id = ?) + (SELECT COUNT(*) FROM vehicle_expense_shares WHERE person_id = ? AND user_id = ?) AS n')
      .get(req.params.id, req.user.id, req.params.id, req.user.id).n;
    if (used) throw conflict('Esta pessoa tem gastos de veículo registrados. Edite ou exclua esses lançamentos antes de excluí-la.');
    const info = db.prepare('DELETE FROM people WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!info.changes) throw notFound('Pessoa não encontrada');
    res.status(204).end();
  });
  return r;
}
