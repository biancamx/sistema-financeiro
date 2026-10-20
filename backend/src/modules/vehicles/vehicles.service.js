import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { round2 } from '../../lib/months.js';
import { splitWeighted } from '../purchases/purchases.service.js';
import { EXPENSE_CATEGORIES, EXPENSE_GROUPS, groupOf } from './vehicles.categories.js';

export const normalizePlate = (p) => String(p).toUpperCase().replace(/[\s-]/g, '');

/** Tudo é filtrado por user_id; ids vindos do cliente são conferidos antes de qualquer gravação. */
export function createVehiclesService(db) {
  const assertOwned = (table, id, userId, label) => {
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId)) throw badRequest(`${label} inválido(a)`);
  };

  // ───────────── Veículos ─────────────
  const vehicleSelect = `
    SELECT v.id, v.kind, v.model, v.plate, v.year, v.purchase_value AS purchaseValue, v.status, v.notes,
           COALESCE((SELECT SUM(amount) FROM vehicle_expenses e WHERE e.vehicle_id = v.id), 0) AS totalSpent,
           (SELECT COUNT(*) FROM vehicle_expenses e WHERE e.vehicle_id = v.id) AS expensesCount,
           (SELECT MAX(km) FROM vehicle_expenses e WHERE e.vehicle_id = v.id) AS currentKm,
           (SELECT MAX(expense_date) FROM vehicle_expenses e WHERE e.vehicle_id = v.id) AS lastExpenseDate
    FROM vehicles v`;
  const shapeVehicle = (r) => ({ ...r, totalSpent: round2(r.totalSpent) });

  const assertPlateFree = (userId, plate, exceptId = 0) => {
    if (db.prepare('SELECT 1 FROM vehicles WHERE user_id = ? AND plate = ? AND id <> ?').get(userId, plate, exceptId)) throw conflict('Já existe um veículo com esta placa');
  };

  // ───────────── Gastos ─────────────
  const expenseSelect = `
    SELECT e.id, e.vehicle_id AS vehicleId, v.model AS vehicleModel, v.plate AS vehiclePlate,
           e.expense_date AS date, e.category, e.description, e.amount, e.km,
           e.payer_id AS payerId, pe.name AS payer, e.shared, e.split_mode AS splitMode
    FROM vehicle_expenses e
    JOIN vehicles v ON v.id = e.vehicle_id
    JOIN people pe ON pe.id = e.payer_id`;

  const loadShares = (ids) => {
    if (!ids.length) return new Map();
    const rows = db
      .prepare(
        `SELECT s.expense_id AS expenseId, s.person_id AS personId, pe.name AS person, s.amount
         FROM vehicle_expense_shares s JOIN people pe ON pe.id = s.person_id
         WHERE s.expense_id IN (${ids.map(() => '?').join(',')}) ORDER BY pe.name COLLATE NOCASE`,
      )
      .all(...ids);
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.expenseId)) m.set(r.expenseId, []);
      m.get(r.expenseId).push({ personId: r.personId, person: r.person, amount: r.amount });
    }
    return m;
  };

  const shapeExpenses = (rows) => {
    const shares = loadShares(rows.map((r) => r.id));
    const labelOf = new Map(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
    return rows.map((r) => ({
      ...r,
      shared: Boolean(r.shared),
      group: groupOf(r.category),
      categoryLabel: labelOf.get(r.category) ?? r.category,
      shares: shares.get(r.id) ?? [],
    }));
  };

  /** Valida e calcula as fatias: individual = tudo para o responsável; compartilhado = rateio igual, por % ou por R$. */
  function computeShares(userId, d, amount) {
    assertOwned('people', d.payerId, userId, 'Pessoa pagadora');
    if (!d.shared) return [{ personId: d.payerId, amount }];
    const list = d.participants;
    for (const p of list) assertOwned('people', p.personId, userId, 'Pessoa');
    const cents = (v) => Math.round((v ?? 0) * 100);
    let weights;
    if (d.splitMode === 'percent') {
      weights = list.map((p) => cents(p.value));
      if (Math.abs(weights.reduce((a, b) => a + b, 0) - 10000) > 1) throw badRequest('A soma das porcentagens deve ser 100%');
    } else if (d.splitMode === 'amount') {
      weights = list.map((p) => cents(p.value));
      if (Math.abs(weights.reduce((a, b) => a + b, 0) - cents(amount)) > 1) throw badRequest('A soma dos valores de cada pessoa deve ser igual ao valor do gasto');
    } else weights = list.map(() => 1);
    if (weights.some((w) => !(w > 0))) throw badRequest('Cada participante precisa ter uma parte maior que zero');
    const parts = splitWeighted(amount, weights);
    return list.map((p, i) => ({ personId: p.personId, amount: parts[i] }));
  }

  function filters(userId, q) {
    const where = ['e.user_id = ?'];
    const params = [userId];
    if (q.vehicleId) (where.push('e.vehicle_id = ?'), params.push(q.vehicleId));
    if (q.category) (where.push('e.category = ?'), params.push(q.category));
    if (q.group) {
      const keys = EXPENSE_CATEGORIES.filter((c) => c.group === q.group).map((c) => c.key);
      where.push(`e.category IN (${keys.map(() => '?').join(',')})`);
      params.push(...keys);
    }
    if (q.personId) {
      where.push('(e.payer_id = ? OR EXISTS (SELECT 1 FROM vehicle_expense_shares s WHERE s.expense_id = e.id AND s.person_id = ?))');
      params.push(q.personId, q.personId);
    }
    if (q.shared !== undefined) (where.push('e.shared = ?'), params.push(q.shared ? 1 : 0));
    if (q.year) (where.push("substr(e.expense_date, 1, 4) = ?"), params.push(String(q.year)));
    if (q.from) (where.push('e.expense_date >= ?'), params.push(q.from));
    if (q.to) (where.push('e.expense_date <= ?'), params.push(q.to));
    if (q.search) (where.push("e.description LIKE ? ESCAPE '\\'"), params.push(`%${q.search.replace(/[\\%_]/g, '\\$&')}%`));
    return { where, params };
  }

  const expenseWriteCols = (userId, d, amount) => [d.vehicleId, d.date, d.category, d.description ?? '', amount, d.km ?? null, d.payerId, d.shared ? 1 : 0, d.shared ? d.splitMode : 'equal', userId];

  return {
    categories: () => ({ groups: EXPENSE_GROUPS, categories: EXPENSE_CATEGORIES }),

    listVehicles(userId) {
      return db.prepare(`${vehicleSelect} WHERE v.user_id = ? ORDER BY (v.status = 'active') DESC, v.model COLLATE NOCASE`).all(userId).map(shapeVehicle);
    },

    getVehicle(userId, id) {
      const row = db.prepare(`${vehicleSelect} WHERE v.id = ? AND v.user_id = ?`).get(id, userId);
      if (!row) throw notFound('Veículo não encontrado');
      return shapeVehicle(row);
    },

    createVehicle(userId, d) {
      const plate = normalizePlate(d.plate);
      assertPlateFree(userId, plate);
      const id = db
        .prepare('INSERT INTO vehicles (user_id, kind, model, plate, year, purchase_value, status, notes) VALUES (?,?,?,?,?,?,?,?)')
        .run(userId, d.kind, d.model, plate, d.year ?? null, d.purchaseValue, d.status, d.notes || null).lastInsertRowid;
      return this.getVehicle(userId, Number(id));
    },

    updateVehicle(userId, id, d) {
      this.getVehicle(userId, id);
      const plate = normalizePlate(d.plate);
      assertPlateFree(userId, plate, id);
      db.prepare('UPDATE vehicles SET kind=?, model=?, plate=?, year=?, purchase_value=?, status=?, notes=? WHERE id=? AND user_id=?').run(
        d.kind, d.model, plate, d.year ?? null, d.purchaseValue, d.status, d.notes || null, id, userId,
      );
      return this.getVehicle(userId, id);
    },

    /** Excluir um veículo apaga o histórico dele; por isso exige `force` quando há lançamentos. */
    removeVehicle(userId, id, force = false) {
      const v = this.getVehicle(userId, id);
      if (v.expensesCount > 0 && !force) throw conflict(`Este veículo tem ${v.expensesCount} lançamento(s). Para manter o histórico, marque-o como Vendido ou Inativo; excluir apaga tudo.`);
      db.prepare('DELETE FROM vehicles WHERE id = ? AND user_id = ?').run(id, userId);
    },

    listExpenses(userId, q) {
      const { where, params } = filters(userId, q);
      const agg = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(e.amount), 0) total FROM vehicle_expenses e WHERE ${where.join(' AND ')}`).get(...params);
      const rows = db
        .prepare(`${expenseSelect} WHERE ${where.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`)
        .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
      return { data: shapeExpenses(rows), page: q.page, pageSize: q.pageSize, total: agg.n, sum: round2(agg.total) };
    },

    getExpense(userId, id) {
      const row = db.prepare(`${expenseSelect} WHERE e.id = ? AND e.user_id = ?`).get(id, userId);
      if (!row) throw notFound('Lançamento não encontrado');
      return shapeExpenses([row])[0];
    },

    createExpense(userId, d) {
      assertOwned('vehicles', d.vehicleId, userId, 'Veículo');
      const amount = round2(d.amount);
      const shares = computeShares(userId, d, amount);
      const id = db.transaction(() => {
        const eid = db
          .prepare('INSERT INTO vehicle_expenses (vehicle_id, expense_date, category, description, amount, km, payer_id, shared, split_mode, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(...expenseWriteCols(userId, d, amount)).lastInsertRowid;
        const ins = db.prepare('INSERT INTO vehicle_expense_shares (expense_id, user_id, person_id, amount) VALUES (?,?,?,?)');
        for (const s of shares) ins.run(eid, userId, s.personId, s.amount);
        return Number(eid);
      })();
      return this.getExpense(userId, id);
    },

    updateExpense(userId, id, d) {
      this.getExpense(userId, id);
      assertOwned('vehicles', d.vehicleId, userId, 'Veículo');
      const amount = round2(d.amount);
      const shares = computeShares(userId, d, amount);
      db.transaction(() => {
        db.prepare('UPDATE vehicle_expenses SET vehicle_id=?, expense_date=?, category=?, description=?, amount=?, km=?, payer_id=?, shared=?, split_mode=? WHERE user_id=? AND id=?').run(
          ...expenseWriteCols(userId, d, amount), id,
        );
        db.prepare('DELETE FROM vehicle_expense_shares WHERE expense_id = ?').run(id);
        const ins = db.prepare('INSERT INTO vehicle_expense_shares (expense_id, user_id, person_id, amount) VALUES (?,?,?,?)');
        for (const s of shares) ins.run(id, userId, s.personId, s.amount);
      })();
      return this.getExpense(userId, id);
    },

    removeExpense(userId, id) {
      const info = db.prepare('DELETE FROM vehicle_expenses WHERE id = ? AND user_id = ?').run(id, userId);
      if (!info.changes) throw notFound('Lançamento não encontrado');
    },

    /** Painel: consolidado da frota (sem vehicleId) ou de um veículo; opcionalmente de um ano. */
    summary(userId, { vehicleId, year } = {}) {
      if (vehicleId) this.getVehicle(userId, vehicleId);
      const { where, params } = filters(userId, { vehicleId, year });
      const W = where.join(' AND ');
      const one = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(e.amount),0) total FROM vehicle_expenses e WHERE ${W}`).get(...params);

      const catRows = db.prepare(`SELECT e.category, COUNT(*) n, SUM(e.amount) total FROM vehicle_expenses e WHERE ${W} GROUP BY e.category`).all(...params);
      const byCategory = EXPENSE_CATEGORIES.map((c) => {
        const r = catRows.find((x) => x.category === c.key);
        return { key: c.key, label: c.label, group: c.group, count: r?.n ?? 0, total: round2(r?.total ?? 0) };
      }).filter((c) => c.count > 0).sort((a, b) => b.total - a.total);
      const byGroup = EXPENSE_GROUPS.map((g) => {
        const items = byCategory.filter((c) => c.group === g.key);
        return { key: g.key, label: g.label, count: items.reduce((s, c) => s + c.count, 0), total: round2(items.reduce((s, c) => s + c.total, 0)) };
      });

      const monthRows = db
        .prepare(`SELECT CAST(substr(e.expense_date,1,4) AS INTEGER) y, CAST(substr(e.expense_date,6,2) AS INTEGER) m, SUM(e.amount) total FROM vehicle_expenses e WHERE ${W} GROUP BY y, m ORDER BY y, m`)
        .all(...params);
      const byMonth = year
        ? Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, total: round2(monthRows.find((r) => r.m === i + 1)?.total ?? 0) }))
        : monthRows.map((r) => ({ year: r.y, month: r.m, total: round2(r.total) }));

      const byVehicle = db
        .prepare(
          `SELECT v.id vehicleId, v.model, v.plate, COUNT(e.id) n, COALESCE(SUM(e.amount),0) total
           FROM vehicles v LEFT JOIN vehicle_expenses e ON e.vehicle_id = v.id ${year ? "AND substr(e.expense_date,1,4) = @year" : ''}
           WHERE v.user_id = @uid ${vehicleId ? 'AND v.id = @vid' : ''} GROUP BY v.id ORDER BY total DESC`,
        )
        .all({ uid: userId, ...(year && { year: String(year) }), ...(vehicleId && { vid: vehicleId }) })
        .map((r) => ({ vehicleId: r.vehicleId, label: `${r.model} · ${r.plate}`, count: r.n, total: round2(r.total) }));

      // Quem pagou × quem assume: saldo > 0 = tem a receber dos outros; < 0 = deve.
      const paid = db.prepare(`SELECT e.payer_id pid, SUM(e.amount) v FROM vehicle_expenses e WHERE ${W} GROUP BY e.payer_id`).all(...params);
      const owes = db
        .prepare(`SELECT s.person_id pid, SUM(s.amount) v FROM vehicle_expense_shares s JOIN vehicle_expenses e ON e.id = s.expense_id WHERE ${W} GROUP BY s.person_id`)
        .all(...params);
      const ids = [...new Set([...paid, ...owes].map((r) => r.pid))];
      const names = new Map(db.prepare('SELECT id, name FROM people WHERE user_id = ?').all(userId).map((p) => [p.id, p.name]));
      const people = ids
        .map((pid) => {
          const p = round2(paid.find((r) => r.pid === pid)?.v ?? 0);
          const o = round2(owes.find((r) => r.pid === pid)?.v ?? 0);
          return { personId: pid, name: names.get(pid), paid: p, owes: o, balance: round2(p - o) };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

      const out = { year: year ?? null, total: round2(one.total), count: one.n, byGroup, byCategory, byMonth, byVehicle, people };
      if (vehicleId) {
        const km = db.prepare('SELECT MIN(km) lo, MAX(km) hi FROM vehicle_expenses WHERE vehicle_id = ? AND km IS NOT NULL').get(vehicleId);
        const all = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM vehicle_expenses WHERE vehicle_id = ?').get(vehicleId).t;
        out.currentKm = km.hi ?? null;
        out.kmSpan = km.hi != null ? km.hi - km.lo : 0;
        out.costPerKm = out.kmSpan > 0 ? round2(all / out.kmSpan) : null; // histórico completo ÷ km rodados registrados
      }
      return out;
    },

    exportCsv(userId, q = {}) {
      const { where, params } = filters(userId, q);
      const rows = shapeExpenses(db.prepare(`${expenseSelect} WHERE ${where.join(' AND ')} ORDER BY e.expense_date, e.id`).all(...params));
      const esc = (v) => {
        let s = v == null ? '' : String(v);
        if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita injeção de fórmula ao abrir no Excel
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = ['Data', 'Veículo', 'Placa', 'Grupo', 'Categoria', 'Descrição', 'Valor', 'KM', 'Pagou', 'Tipo', 'Rateio'];
      const groupLabel = new Map(EXPENSE_GROUPS.map((g) => [g.key, g.label]));
      const lines = rows.map((r) => [
        r.date, r.vehicleModel, r.vehiclePlate, groupLabel.get(r.group), r.categoryLabel, r.description, r.amount, r.km, r.payer,
        r.shared ? 'Compartilhado' : 'Individual', r.shares.map((s) => `${s.person}: ${s.amount.toFixed(2)}`).join(' | '),
      ]);
      return [head, ...lines].map((l) => l.map(esc).join(';')).join('\n');
    },
  };
}
