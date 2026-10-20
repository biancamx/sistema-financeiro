import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../../lib/errors.js';
import { round2 } from '../../lib/months.js';

/** Divide o total em parcelas (centavos), jogando a diferença na última. */
export function buildSchedule({ total, count, startYear, startMonth }) {
  const base = round2(total / count);
  const out = [];
  for (let n = 0; n < count; n++) {
    const idx = startYear * 12 + (startMonth - 1) + n;
    out.push({
      number: n + 1,
      year: Math.floor(idx / 12),
      month: (idx % 12) + 1,
      amount: n === count - 1 ? round2(total - base * (count - 1)) : base,
    });
  }
  return out;
}

/**
 * Divide um valor entre pessoas em centavos, na proporção dos `weights`, sem perder nem criar dinheiro
 * (maiores restos; empate = quem vem primeiro a partir de `offset`, que o chamador gira a cada parcela).
 * R$ 130,00 em partes iguais ÷ 2 = [65,00; 65,00] · ÷ 3 = [43,34; 43,33; 43,33] · 50%/25%/25% = [65,00; 32,50; 32,50].
 */
export function splitWeighted(amount, weights, offset = 0) {
  const n = weights.length;
  const cents = BigInt(Math.round(amount * 100));
  const w = weights.map((x) => BigInt(x));
  const W = w.reduce((a, b) => a + b, 0n);
  const base = w.map((x) => (cents * x) / W);
  let rest = Number(cents - base.reduce((a, b) => a + b, 0n));
  const order = w
    .map((x, i) => ({ i, frac: (cents * x) % W, tie: (i - (offset % n) + n) % n }))
    .sort((a, b) => (a.frac === b.frac ? a.tie - b.tie : a.frac > b.frac ? -1 : 1));
  const out = base.map(Number);
  for (const o of order) if (rest-- > 0) out[o.i] += 1;
  return out.map((c) => c / 100);
}

/** Partes iguais (caso particular de splitWeighted). */
export const splitAmount = (amount, parts, offset = 0) => splitWeighted(amount, Array(parts).fill(1), offset);

/** Cronograma da compra inteira (igual ao individual) + a fatia de cada participante em cada parcela. `weights`: lista de pesos, ou nº de pessoas (partes iguais). */
export function buildSharedSchedule({ total, count, startYear, startMonth }, weights) {
  const w = Array.isArray(weights) ? weights : Array(weights).fill(1);
  return buildSchedule({ total, count, startYear, startMonth }).map((s, j) => ({ ...s, shares: splitWeighted(s.amount, w, j) }));
}

export function createPurchasesService(db) {
  const assertOwned = (table, id, userId, label) => {
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId)) throw badRequest(`${label} inválido(a)`);
  };

  const purchaseSelect = `
    SELECT p.id, p.description, p.purchase_date AS purchaseDate, p.total, p.installments_count AS count,
           p.person_id AS personId, pe.name AS person, p.card_id AS cardId, c.name AS card,
           p.category_id AS categoryId, cat.name AS category, p.shared_group AS sharedGroup,
           (SELECT SUM(total) FROM purchases WHERE shared_group = p.shared_group) AS groupTotal,
           (SELECT GROUP_CONCAT(pe2.name, ', ') FROM purchases p2 JOIN people pe2 ON pe2.id = p2.person_id WHERE p2.shared_group = p.shared_group) AS participantsNames,
           (SELECT MIN(year * 12 + month) FROM installments WHERE purchase_id = p.id) AS firstIdx,
           (SELECT MAX(year * 12 + month) FROM installments WHERE purchase_id = p.id) AS lastIdx,
           (SELECT COUNT(*) FROM installments WHERE purchase_id = p.id) AS scheduled,
           (SELECT COUNT(*) FROM installments WHERE purchase_id = p.id AND paid = 1) AS paidCount
    FROM purchases p
    JOIN people pe ON pe.id = p.person_id
    JOIN cards c ON c.id = p.card_id
    LEFT JOIN categories cat ON cat.id = p.category_id`;

  /** `collapse`: no "Todas as compras" a compra compartilhada aparece uma vez só, com o total do grupo. */
  const shape = (row, collapse = false) => {
    const first = row.firstIdx == null ? null : { year: Math.floor((row.firstIdx - 1) / 12), month: ((row.firstIdx - 1) % 12) + 1 };
    const last = row.lastIdx == null ? null : { year: Math.floor((row.lastIdx - 1) / 12), month: ((row.lastIdx - 1) % 12) + 1 };
    const { firstIdx, lastIdx, groupTotal, participantsNames, ...rest } = row;
    const out = { ...rest, shared: Boolean(row.sharedGroup), perInstallment: round2(row.total / row.count), first, last };
    if (out.shared) {
      out.groupTotal = round2(groupTotal);
      out.participants = participantsNames;
      if (collapse) Object.assign(out, { total: out.groupTotal, perInstallment: round2(groupTotal / row.count), person: participantsNames, personId: null });
    }
    return out;
  };

  const assertNotShared = (userId, id) => {
    const r = db.prepare('SELECT shared_group AS g FROM purchases WHERE id = ? AND user_id = ?').get(id, userId);
    if (r?.g) throw badRequest('Esta compra é compartilhada: edite ou exclua pela compra compartilhada (todos os participantes de uma vez).');
  };

  function filters(userId, q, alias = 'p') {
    const where = [`${alias}.user_id = ?`];
    const params = [userId];
    if (q.personId) (where.push(`${alias}.person_id = ?`), params.push(q.personId));
    if (q.cardId) (where.push(`${alias}.card_id = ?`), params.push(q.cardId));
    if (q.categoryId) (where.push(`${alias}.category_id = ?`), params.push(q.categoryId));
    if (q.search) (where.push(`${alias}.description LIKE ? ESCAPE '\\'`), params.push(`%${q.search.replace(/[\\%_]/g, '\\$&')}%`));
    return { where, params };
  }

  return {
    /** Visão "Banco de Dados" filtrada por mês: uma linha por parcela. */
    listInstallments(userId, q) {
      const { where, params } = filters(userId, q);
      where.push('i.year = ?', 'i.month = ?');
      params.push(q.year, q.month);
      const rows = db
        .prepare(
          `SELECT i.id, i.purchase_id AS purchaseId, i.number, p.installments_count AS count, i.amount,
                  i.paid_amount AS paidAmount, i.paid,
                  p.description, pe.name AS person, c.name AS card, cat.name AS category, p.shared_group AS sharedGroup,
                  (SELECT GROUP_CONCAT(pe2.name, ', ') FROM purchases p2 JOIN people pe2 ON pe2.id = p2.person_id
                   WHERE p2.shared_group = p.shared_group AND p2.id <> p.id) AS sharedWith
           FROM installments i
           JOIN purchases p ON p.id = i.purchase_id
           JOIN people pe ON pe.id = p.person_id
           JOIN cards c ON c.id = p.card_id
           LEFT JOIN categories cat ON cat.id = p.category_id
           WHERE ${where.join(' AND ')} ORDER BY c.name, pe.name, p.description`,
        )
        .all(...params)
        .map((r) => ({ ...r, paid: Boolean(r.paid) }));
      return { data: rows, total: round2(rows.reduce((s, r) => s + r.amount, 0)) };
    },

    list(userId, q) {
      const { where, params } = filters(userId, q);
      // Sem filtro de pessoa, cada compartilhada aparece uma vez só (pela primeira compra do grupo).
      // Filtrando por pessoa, aparece a fatia dela.
      const collapse = !q.personId;
      if (collapse) where.push('(p.shared_group IS NULL OR p.id = (SELECT MIN(id) FROM purchases WHERE shared_group = p.shared_group))');
      const total = db.prepare(`SELECT COUNT(*) n FROM purchases p WHERE ${where.join(' AND ')}`).get(...params).n;
      const rows = db
        .prepare(`${purchaseSelect} WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ? OFFSET ?`)
        .all(...params, q.pageSize, (q.page - 1) * q.pageSize);
      return { data: rows.map((r) => shape(r, collapse)), page: q.page, pageSize: q.pageSize, total };
    },

    get(userId, id) {
      const row = db.prepare(`${purchaseSelect} WHERE p.id = ? AND p.user_id = ?`).get(id, userId);
      if (!row) throw notFound('Compra não encontrada');
      const installments = db
        .prepare('SELECT id, number, year, month, amount, paid_amount AS paidAmount, paid FROM installments WHERE purchase_id = ? ORDER BY year, month, number')
        .all(id)
        .map((i) => ({ ...i, paid: Boolean(i.paid) }));
      return { ...shape(row), installments };
    },

    create(userId, d) {
      assertOwned('people', d.personId, userId, 'Pessoa');
      assertOwned('cards', d.cardId, userId, 'Cartão');
      if (d.categoryId) assertOwned('categories', d.categoryId, userId, 'Categoria');
      const id = db.transaction(() => {
        const pid = db
          .prepare('INSERT INTO purchases (user_id, description, category_id, person_id, card_id, purchase_date, total, installments_count) VALUES (?,?,?,?,?,?,?,?)')
          .run(userId, d.description, d.categoryId ?? null, d.personId, d.cardId, d.purchaseDate ?? null, d.total, d.count).lastInsertRowid;
        const ins = db.prepare('INSERT INTO installments (user_id, purchase_id, number, year, month, amount) VALUES (?,?,?,?,?,?)');
        for (const s of buildSchedule(d)) ins.run(userId, pid, s.number, s.year, s.month, s.amount);
        return Number(pid);
      })();
      return this.get(userId, id);
    },

    update(userId, id, d) {
      const cur = this.get(userId, id);
      assertNotShared(userId, id);
      assertOwned('people', d.personId, userId, 'Pessoa');
      assertOwned('cards', d.cardId, userId, 'Cartão');
      if (d.categoryId) assertOwned('categories', d.categoryId, userId, 'Categoria');
      const first = cur.first || { year: d.startYear, month: d.startMonth };
      const scheduleChanged = cur.total !== d.total || cur.count !== d.count || first.year !== d.startYear || first.month !== d.startMonth;
      db.transaction(() => {
        db.prepare('UPDATE purchases SET description=?, category_id=?, person_id=?, card_id=?, purchase_date=?, total=?, installments_count=? WHERE id=? AND user_id=?').run(
          d.description, d.categoryId ?? null, d.personId, d.cardId, d.purchaseDate ?? null, d.total, d.count, id, userId,
        );
        if (scheduleChanged) {
          const paid = new Map(cur.installments.map((i) => [i.number, i.paidAmount]));
          db.prepare('DELETE FROM installments WHERE purchase_id = ?').run(id);
          const ins = db.prepare('INSERT INTO installments (user_id, purchase_id, number, year, month, amount, paid, paid_amount) VALUES (?,?,?,?,?,?,?,?)');
          for (const s of buildSchedule(d)) {
            const paidAmount = Math.min(s.amount, paid.get(s.number) ?? 0);
            ins.run(userId, id, s.number, s.year, s.month, s.amount, paidAmount >= s.amount - 0.005 ? 1 : 0, paidAmount);
          }
        }
      })();
      return this.get(userId, id);
    },

    remove(userId, id) {
      assertNotShared(userId, id);
      const info = db.prepare('DELETE FROM purchases WHERE id = ? AND user_id = ?').run(id, userId);
      if (!info.changes) throw notFound('Compra não encontrada');
    },

    // ───────────── Compras compartilhadas (várias pessoas dividem a mesma compra) ─────────────

    /**
     * Valida participantes/cartão/categoria e devolve [{ personId, weight }].
     * d.splitMode: 'equal' (partes iguais) · 'percent' (soma 100%) · 'amount' (R$ do total da compra de cada um; soma = total).
     */
    _checkShared(userId, d) {
      const list = d.participants;
      if (list.length < 2) throw badRequest('Escolha pelo menos 2 participantes');
      for (const p of list) assertOwned('people', p.personId, userId, 'Pessoa');
      assertOwned('cards', d.cardId, userId, 'Cartão');
      if (d.categoryId) assertOwned('categories', d.categoryId, userId, 'Categoria');
      let weights;
      if (d.splitMode === 'percent') {
        weights = list.map((p) => Math.round((p.value ?? 0) * 100));
        if (Math.abs(weights.reduce((a, b) => a + b, 0) - 10000) > 1) throw badRequest('A soma das porcentagens deve ser 100%');
      } else if (d.splitMode === 'amount') {
        weights = list.map((p) => Math.round((p.value ?? 0) * 100));
        if (Math.abs(weights.reduce((a, b) => a + b, 0) - Math.round(d.total * 100)) > 1) throw badRequest('A soma dos valores de cada pessoa deve ser igual ao total da compra');
      } else weights = list.map(() => 1);
      if (weights.some((w) => !(w > 0))) throw badRequest('Cada participante precisa ter uma parte maior que zero');
      return list.map((p, i) => ({ personId: p.personId, weight: weights[i] }));
    },

    /**
     * Grava uma compra por participante, cada uma com a sua fatia de cada parcela.
     * `paidAmounts` (opcional) preserva valores quitados por pessoa e número da parcela ao editar.
     */
    _insertShared(userId, group, parts, d, paidAmounts = new Map()) {
      const schedule = buildSharedSchedule(d, parts.map((p) => p.weight));
      if (schedule.some((s) => s.shares.some((v) => !(v > 0)))) throw badRequest('Valor pequeno demais para dividir desse jeito entre as pessoas e parcelas');
      const insP = db.prepare('INSERT INTO purchases (user_id, description, category_id, person_id, card_id, purchase_date, total, installments_count, shared_group) VALUES (?,?,?,?,?,?,?,?,?)');
      const insI = db.prepare('INSERT INTO installments (user_id, purchase_id, number, year, month, amount, paid, paid_amount) VALUES (?,?,?,?,?,?,?,?)');
      parts.forEach(({ personId }, k) => {
        const mine = schedule.map((s) => ({ ...s, amount: s.shares[k] }));
        const total = round2(mine.reduce((a, s) => a + s.amount, 0));
        const pid = insP.run(userId, d.description, d.categoryId ?? null, personId, d.cardId, d.purchaseDate ?? null, total, d.count, group).lastInsertRowid;
        for (const s of mine) {
          const paidAmount = Math.min(s.amount, Math.max(0, paidAmounts.get(`${personId}:${s.number}`) ?? 0));
          insI.run(userId, pid, s.number, s.year, s.month, s.amount, paidAmount >= s.amount - 0.005 ? 1 : 0, paidAmount);
        }
      });
    },

    createShared(userId, d) {
      const parts = this._checkShared(userId, d);
      const group = randomUUID();
      db.transaction(() => this._insertShared(userId, group, parts, d))();
      return this.getShared(userId, group);
    },

    getShared(userId, group) {
      const rows = db.prepare(`${purchaseSelect} WHERE p.shared_group = ? AND p.user_id = ? ORDER BY p.id`).all(group, userId);
      if (!rows.length) throw notFound('Compra compartilhada não encontrada');
      const head = shape(rows[0]);
      const ids = rows.map((r) => r.id);
      const personOf = new Map(rows.map((r) => [r.id, r.personId]));
      const inst = db
        .prepare(`SELECT id, purchase_id AS purchaseId, number, year, month, amount, paid_amount AS paidAmount, paid FROM installments WHERE purchase_id IN (${ids.map(() => '?').join(',')}) ORDER BY number, id`)
        .all(...ids);
      const byNumber = new Map();
      for (const i of inst) {
        if (!byNumber.has(i.number)) byNumber.set(i.number, { number: i.number, year: i.year, month: i.month, amount: 0, shares: [] });
        const n = byNumber.get(i.number);
        n.amount = round2(n.amount + i.amount);
        n.shares.push({ installmentId: i.id, personId: personOf.get(i.purchaseId), amount: i.amount, paidAmount: i.paidAmount, paid: Boolean(i.paid) });
      }
      const installments = [...byNumber.values()];
      const total = round2(rows.reduce((a, r) => a + r.total, 0));
      const totals = rows.map((r) => r.total);
      const splitMode = Math.max(...totals) - Math.min(...totals) <= 0.03 ? 'equal' : 'amount'; // partes quase idênticas = divisão igual
      return {
        group, description: head.description, categoryId: head.categoryId, category: head.category, cardId: head.cardId, card: head.card,
        purchaseDate: head.purchaseDate, total, count: head.count, perInstallment: installments[0]?.amount ?? round2(total / head.count),
        first: head.first, last: head.last,
        splitMode,
        participants: rows.map((r) => ({ personId: r.personId, person: r.person, purchaseId: r.id, total: r.total, percent: round2((r.total / total) * 100), paidCount: r.paidCount })),
        installments,
      };
    },

    updateShared(userId, group, d) {
      const cur = this.getShared(userId, group);
      const parts = this._checkShared(userId, d);
      const paidAmounts = new Map();
      for (const i of cur.installments) for (const s of i.shares) paidAmounts.set(`${s.personId}:${i.number}`, s.paidAmount);
      db.transaction(() => {
        db.prepare('DELETE FROM purchases WHERE shared_group = ? AND user_id = ?').run(group, userId);
        this._insertShared(userId, group, parts, d, paidAmounts);
      })();
      return this.getShared(userId, group);
    },

    removeShared(userId, group) {
      const info = db.prepare('DELETE FROM purchases WHERE shared_group = ? AND user_id = ?').run(group, userId);
      if (!info.changes) throw notFound('Compra compartilhada não encontrada');
    },

    setPaid(userId, installmentId, paid) {
      const installment = db.prepare('SELECT amount FROM installments WHERE id = ? AND user_id = ?').get(installmentId, userId);
      if (!installment) throw notFound('Parcela não encontrada');
      const paidAmount = paid ? installment.amount : 0;
      db.prepare('UPDATE installments SET paid = ?, paid_amount = ? WHERE id = ? AND user_id = ?').run(paid ? 1 : 0, paidAmount, installmentId, userId);
      return { id: installmentId, paid };
    },

    exportCsv(userId) {
      const rows = db
        .prepare(
          `SELECT p.purchase_date, p.description, cat.name AS category, pe.name AS person, c.name AS card, p.total, p.installments_count,
                  i.number, i.month, i.year, i.amount, i.paid
           FROM installments i JOIN purchases p ON p.id = i.purchase_id
           JOIN people pe ON pe.id = p.person_id JOIN cards c ON c.id = p.card_id
           LEFT JOIN categories cat ON cat.id = p.category_id
           WHERE p.user_id = ? ORDER BY i.year, i.month, c.name`,
        )
        .all(userId);
      const esc = (v) => {
        let s = v == null ? '' : String(v);
        if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita injeção de fórmula ao abrir no Excel
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = ['Data da compra', 'Descrição', 'Categoria', 'Pessoa', 'Cartão', 'Valor total', 'Qtd. parcelas', 'Parcela nº', 'Mês', 'Ano', 'Valor da parcela', 'Paga'];
      return [head, ...rows.map((r) => [r.purchase_date, r.description, r.category, r.person, r.card, r.total, r.installments_count, r.number, r.month, r.year, r.amount, r.paid ? 'sim' : 'não'])]
        .map((l) => l.map(esc).join(';'))
        .join('\n');
    },
  };
}
