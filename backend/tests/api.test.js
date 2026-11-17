import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-api';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { openDb } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { PORTAL_TOKEN_PATTERN } = await import('../src/modules/portal/portal.routes.js');
const { calcRescission } = await import('../src/modules/tools/rescission.js');
const { buildSchedule, splitAmount, splitWeighted, buildSharedSchedule } = await import('../src/modules/purchases/purchases.service.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  db.close();
});

// cliente mínimo com cookie
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
}

test('health oficial e config públicos; Google desativado por padrão', async () => {
  const c = client();
  assert.equal((await c('GET', '/system/health')).json.status, 'ok');
  assert.equal((await c('GET', '/health')).status, 401);
  const cfg = (await c('GET', '/auth/config')).json;
  assert.equal(cfg.google.enabled, false);
  assert.equal(cfg.local.enabled, true);
  const g = await c('POST', '/auth/google', { credential: 'x'.repeat(20) });
  assert.equal(g.status, 501);
});

test('callback de redirecionamento do Google exige CSRF cookie/body correspondentes', async () => {
  const postCallback = (csrfToken) => fetch(`${base}/auth/google/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: 'g_csrf_token=token-cookie',
      Origin: 'https://accounts.google.com',
    },
    body: new URLSearchParams({ g_csrf_token: csrfToken }),
  });

  const invalidCsrf = await postCallback('token-body');
  assert.equal(invalidCsrf.status, 403);
  assert.notEqual((await invalidCsrf.json()).error?.message, 'Origem não permitida');
  assert.equal((await postCallback('token-cookie')).status, 400);

  const rejectedOrigin = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://accounts.google.com',
    },
    body: JSON.stringify({}),
  });
  assert.equal(rejectedOrigin.status, 403);
});

test('rotas privadas exigem login', async () => {
  const c = client();
  assert.equal((await c('GET', '/auth/me')).status, 401);
  assert.equal((await c('POST', '/import/preview')).status, 401);
  assert.equal((await c('GET', '/people')).status, 401);
  assert.equal((await c('GET', '/reminders/settings')).status, 401);
  assert.equal((await c('GET', '/system/portal-contact')).status, 401);
  assert.equal((await c('GET', '/dashboard/summary?month=1&year=2026')).status, 401);
});

test('contato do WhatsApp do portal é configurável e limitado às pessoas da conta', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const created = await c('POST', '/people', { name: 'Contato do Portal', phone: '(00) 00000-0000' });
  assert.equal(created.status, 201);

  const saved = await c('PUT', '/system/portal-contact', { personId: created.json.data.id });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.name, 'Contato do Portal');
  assert.equal((await c('GET', '/system/portal-contact')).json.data.phone, '(00) 00000-0000');

  const withoutPhone = await c('POST', '/people', { name: 'Sem telefone' });
  assert.equal((await c('PUT', '/system/portal-contact', { personId: withoutPhone.json.data.id })).status, 400);
  assert.equal((await c('PUT', '/system/portal-contact', { personId: 999999 })).status, 400);
  assert.equal((await c('PUT', '/system/portal-contact', { personId: null })).json.data.phone, null);
});

test('preferências de agendamento são isoladas, validadas e persistentes', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const defaults = await c('GET', '/reminders/settings');
  assert.equal(defaults.status, 200);
  assert.deepEqual(defaults.json.data, { enabled: 1, trigger_day: 5, trigger_hour: 9, auto_send: 0 });

  const saved = await c('PUT', '/reminders/settings', {
    trigger_day: 15,
    trigger_hour: 18,
    enabled: false,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.data, { enabled: 0, trigger_day: 15, trigger_hour: 18, auto_send: 0 });
  assert.deepEqual((await c('GET', '/reminders/settings')).json.data, saved.json.data);
  assert.equal((await c('PUT', '/reminders/settings', {
    trigger_day: 32,
    trigger_hour: 18,
    enabled: true,
  })).status, 400);

  const other = client();
  await other('POST', '/auth/register', { name: 'Outra conta', email: 'reminder-settings@teste.com', password: 'senha-forte-123' });
  assert.deepEqual((await other('GET', '/reminders/settings')).json.data, {
    enabled: 1,
    trigger_day: 5,
    trigger_hour: 9,
    auto_send: 0,
  });
});

test('perfil de pessoa salva campos de contato, avatar e sincroniza aniversário', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const created = await c('POST', '/people', {
    name: 'Pessoa com perfil',
    phone: '(00) 00000-0000',
    email: 'Pessoa@EXEMPLO.com',
    birthDate: '2000-01-01',
    pixKey: 'chave-pix-teste',
    avatar: 'data:image/jpeg;base64,aGVsbG8=',
    notes: 'Observação de teste',
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.data.phone, '(00) 00000-0000');
  assert.equal(created.json.data.email, 'pessoa@exemplo.com');
  assert.equal(created.json.data.birth_date, '2000-01-01');
  assert.equal(created.json.data.pix_key, 'chave-pix-teste');
  assert.equal(created.json.data.avatar, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal(created.json.data.notes, 'Observação de teste');
  const birthday = (await c('GET', '/birthdays')).json.data.find((item) => item.personId === created.json.data.id);
  assert.deepEqual([birthday.name, birthday.day, birthday.month], ['Pessoa com perfil', 1, 1]);

  const updated = await c('PUT', `/people/${created.json.data.id}`, { name: 'Pessoa renomeada' });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.phone, '(00) 00000-0000');
  assert.equal(updated.json.data.email, 'pessoa@exemplo.com');
  assert.equal(updated.json.data.birth_date, '2000-01-01');
  assert.equal((await c('GET', '/birthdays')).json.data.find((item) => item.personId === created.json.data.id).name, 'Pessoa renomeada');

  const listed = (await c('GET', '/people')).json.data.find((person) => person.id === created.json.data.id);
  assert.equal(listed.phone, '(00) 00000-0000');
  assert.equal((await c('PUT', `/people/${created.json.data.id}`, { name: 'Pessoa renomeada', birthDate: null, phone: null })).json.data.phone, null);
  assert.equal((await c('GET', '/birthdays')).json.data.some((item) => item.personId === created.json.data.id), false);
  assert.equal((await c('POST', '/people', { name: 'Data inválida', birthDate: '2000-02-30' })).status, 400);
});

test('portal pública aceita tokens válidos em faixas maiores que o padrão', () => {
  assert.equal(PORTAL_TOKEN_PATTERN.test('A2b3C4d5E6f7G8h9Jk10'), true);
  assert.equal(PORTAL_TOKEN_PATTERN.test('f'.repeat(8)), true);
  assert.equal(PORTAL_TOKEN_PATTERN.test('f'.repeat(5)), false);
  assert.equal(PORTAL_TOKEN_PATTERN.test('f'.repeat(65)), false);
});

test('portal público consulta dados pelo token e não exige sessão', async () => {
  const c = client();
  assert.equal((await c('POST', '/auth/local')).status, 200);
  const people = (await c('GET', '/people')).json.data;
  const participant = people.find((person) => person.share_token);
  assert.ok(participant);
  assert.match(participant.share_token, /^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
  assert.equal(new Set(people.map((person) => person.share_token)).size, people.length);

  const response = await c('GET', `/portal/${participant.share_token}`);
  assert.equal(response.status, 200);
  assert.equal(response.json.data.person.name, participant.name);
  assert.ok(Array.isArray(response.json.data.months));
  assert.deepEqual(Object.keys(response.json.data.totals), ['grandTotal', 'grandPaid', 'grandPending', 'paid', 'pending', 'future']);
  assert.equal(response.json.data.admin.phone, null);
  assert.equal(response.json.data.months.every((month) => Array.isArray(month.cards) && Array.isArray(month.fixedExpenses)), true);
  assert.equal(response.json.data.months.some((month) => month.cards.some((card) => Array.isArray(card.items))), true);
  const monthTotal = response.json.data.months.reduce((sum, month) => sum + month.total, 0);
  assert.equal(Math.round(monthTotal * 100), Math.round(response.json.data.totals.grandTotal * 100));
  assert.equal(Object.hasOwn(response.json.data.person, 'email'), false);
  assert.equal((await c('GET', `/portal/${'f'.repeat(8)}`)).status, 404);
  assert.equal((await c('POST', `/portal/${participant.share_token}`)).status, 404);
});

test('portal usa o telefone da pessoa configurada como contato do proprietário', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const participant = await c('POST', '/people', { name: 'Participante com portal' });
  const contact = await c('POST', '/people', { name: 'Responsável WhatsApp', phone: '00000000000' });
  await c('PUT', '/system/portal-contact', { personId: contact.json.data.id });

  const portal = await c('GET', `/portal/${participant.json.data.share_token}`);
  assert.equal(portal.status, 200);
  assert.equal(portal.json.data.admin.phone, '00000000000');
});

test('modo local carrega dados de demonstração sintéticos', async () => {
  const c = client();
  assert.equal((await c('POST', '/auth/local')).status, 200);
  const people = (await c('GET', '/people')).json.data;
  assert.deepEqual(people.map((p) => p.name).sort(), ['Pessoa 01', 'Pessoa 02', 'Pessoa 03']);
  const r = await c('GET', '/dashboard/summary?month=1&year=2026');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.data.totals.month, 'number');
  assert.equal(r.json.data.cardTotals.length, 2);
  assert.ok(r.json.data.people.find((p) => p.name === 'Pessoa 01').owed > 0);
});

test('orçamento mensal sintético mantém totais internamente consistentes', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const people = (await c('GET', '/people')).json.data;
  const personOne = people.find((p) => p.name === 'Pessoa 01');
  const s = (await c('GET', `/budgets?personId=${personOne.id}&year=2026`)).json.data;
  const revenue = s.summary.lines.find((l) => l.key === 'revenue').values;
  assert.equal(revenue[0], 3000);
  const cardsSection = s.sections.find((x) => x.key === 'cards');
  assert.ok(cardsSection.rows.length > 0 && cardsSection.totals[0] > 0);
  const balance = s.summary.lines.find((l) => l.key === 'balance').values;
  const spent = s.summary.lines.find((l) => l.key === 'spent').values;
  assert.equal(Math.round((revenue[0] - spent[0]) * 100), Math.round(balance[0] * 100));
});

test('criar compra parcelada gera parcelas e fecha no total', async () => {
  const sched = buildSchedule({ total: 100, count: 3, startYear: 2026, startMonth: 11 });
  assert.deepEqual(sched.map((s) => [s.year, s.month]), [[2026, 11], [2026, 12], [2027, 1]]);
  assert.equal(sched.reduce((a, s) => a + s.amount, 0).toFixed(2), '100.00');

  const c = client();
  await c('POST', '/auth/local');
  const people = (await c('GET', '/people')).json.data;
  const cards = (await c('GET', '/cards?month=1&year=2026')).json.data;
  const res = await c('POST', '/purchases', { description: 'Teste', personId: people[0].id, cardId: cards[0].id, total: 300, count: 3, startMonth: 12, startYear: 2026 });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.installments.length, 3);
  const upd = await c('PUT', `/purchases/${res.json.data.id}`, { description: 'Teste', personId: people[0].id, cardId: cards[0].id, total: 400, count: 4, startMonth: 12, startYear: 2026 });
  assert.equal(upd.json.data.installments.length, 4);
  assert.equal((await c('DELETE', `/purchases/${res.json.data.id}`)).status, 204);
});

test('cartão mantém aparência e titular, e pagamentos liberam o limite em aberto', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const person = (await c('GET', '/people')).json.data[0];
  const created = await c('POST', '/cards', {
    name: 'Cartão visual teste', limit: 1000, issuer: 'Cartao de exemplo', brand: 'Visa', lastFour: '0000',
    color: '#820ad1', imageData: 'data:image/jpeg;base64,aGVsbG8=', ownerId: person.id, dueDay: 22, closingDay: 7,
  });
  assert.equal(created.status, 201);
  const cardId = created.json.data.id;
  const listed = (await c('GET', '/cards?month=1&year=2099&withImages=true')).json.data.find((card) => card.id === cardId);
  assert.equal(listed.issuer, 'Cartao de exemplo');
  assert.equal(listed.brand, 'Visa');
  assert.equal(listed.lastFour, '0000');
  assert.equal(listed.imageData, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal(listed.owner, person.name);
  assert.equal(listed.dueDay, 22);
  assert.equal(listed.closingDay, 7);
  const updated = await c('PUT', `/cards/${cardId}`, { ...created.json.data, dueDay: 24, closingDay: 9 });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.dueDay, 24);
  assert.equal(updated.json.data.closingDay, 9);
  const lightweight = (await c('GET', '/cards?month=1&year=2099')).json.data.find((card) => card.id === cardId);
  assert.equal(lightweight.imageData, null);
  assert.equal(lightweight.dueDay, 24);
  assert.equal(lightweight.closingDay, 9);

  const purchase = await c('POST', '/purchases', {
    description: 'Compra teste do limite', personId: person.id, cardId, total: 300, count: 3, startMonth: 1, startYear: 2099,
  });
  assert.equal(purchase.status, 201);
  const installments = purchase.json.data.installments;
  const beforePayment = (await c('GET', '/cards?month=1&year=2099')).json.data.find((card) => card.id === cardId);
  assert.equal(beforePayment.used, 300);
  assert.equal(beforePayment.invoice, 100);

  const partial = await c('POST', `/cards/${cardId}/payments`, { month: 1, year: 2099, amount: 25 });
  assert.equal(partial.status, 200);
  const afterPartial = (await c('GET', '/cards?month=1&year=2099')).json.data.find((card) => card.id === cardId);
  assert.equal(afterPartial.used, 275);
  assert.equal(afterPartial.invoice, 75);
  assert.equal((await c('POST', `/cards/${cardId}/payments`, { month: 1, year: 2099, amount: 76 })).status, 400);

  assert.equal((await c('PATCH', `/purchases/installments/${installments[0].id}`, { paid: true })).status, 200);
  const afterPayment = (await c('GET', '/cards?month=1&year=2099')).json.data.find((card) => card.id === cardId);
  assert.equal(afterPayment.used, 200);
  assert.equal(afterPayment.invoice, 0);
});

test('relatórios de cobrança agrupam parcelas, saldo parcial e link de WhatsApp', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const userId = db.prepare("SELECT id FROM users WHERE email = 'demo@local.dev'").get().id;
  const person = (await c('POST', '/people', { name: 'Pessoa teste cobrança' })).json.data;
  db.prepare('UPDATE people SET phone = ? WHERE id = ? AND user_id = ?').run('00000000000', person.id, userId);
  const card = (await c('POST', '/cards', { name: 'Cartão cobrança teste', limit: 5000 })).json.data;
  const purchase = await c('POST', '/purchases', {
    description: 'Compra cobrança teste', personId: person.id, cardId: card.id,
    total: 300, count: 3, startMonth: 1, startYear: 2100,
  });
  assert.equal(purchase.status, 201);
  await c('POST', `/cards/${card.id}/payments`, { month: 1, year: 2100, amount: 25 });
  const sheetId = db.prepare('INSERT INTO budget_sheets (user_id, person_id, year) VALUES (?, ?, ?)').run(userId, person.id, 2100).lastInsertRowid;
  const fixedRowId = db.prepare("INSERT INTO budget_rows (user_id, sheet_id, section, label, position) VALUES (?, ?, 'fixed', 'Aluguel', 1)").run(userId, sheetId).lastInsertRowid;
  db.prepare('INSERT INTO budget_cells (row_id, user_id, month, value) VALUES (?, ?, ?, ?)').run(fixedRowId, userId, 1, 80);

  const billing = await c('GET', `/reminders/billing/${person.id}?month=1&year=2100`);
  assert.equal(billing.status, 200);
  assert.equal(billing.json.totalCardsAmount, 100);
  assert.equal(billing.json.totalFixedExpenses, 80);
  assert.equal(billing.json.grandTotal, 180);
  assert.equal(billing.json.grandTotalPending, 155);
  assert.equal(billing.json.totalAmount, 180);
  assert.equal(billing.json.totalPending, 155);
  assert.equal(billing.json.fixedExpenses[0].label, 'Aluguel');
  assert.equal(billing.json.cards[0].dueDay, 10);
  assert.equal(billing.json.cards[0].closingDay, 3);
  assert.equal(billing.json.cards[0].items[0].remaining, 2);
  assert.equal(billing.json.cards[0].items[0].balanceDue, 75);
  assert.match(billing.json.formattedMessage, /Janeiro\/2100/);
  assert.match(billing.json.formattedMessage, /Vencimento 10\/01\/2100/);
  assert.match(billing.json.formattedMessage, /Total Geral do Mês:.*180,00/);
  assert.match(billing.json.formattedMessage, /Saldo Restante a Pagar:.*155,00/);
  assert.match(billing.json.whatsappLink, /phone=5500000000000/);

  const detailedRowId = db.prepare("INSERT INTO budget_rows (user_id, sheet_id, section, label, position) VALUES (?, ?, 'housing', 'Energia', 2)").run(userId, sheetId).lastInsertRowid;
  db.prepare('INSERT INTO budget_cells (row_id, user_id, month, value) VALUES (?, ?, ?, ?)').run(detailedRowId, userId, 1, 30);
  const detailedBilling = await c('GET', `/reminders/billing/${person.id}?month=1&year=2100`);
  assert.equal(detailedBilling.json.totalFixedExpenses, 30);
  assert.deepEqual(detailedBilling.json.fixedExpenses.map((expense) => expense.label), ['Energia']);
  assert.equal(detailedBilling.json.grandTotal, 130);

  const settled = await c('POST', '/reminders/settle-person-month', { personId: person.id, month: 1, year: 2100 });
  assert.equal(settled.status, 200);
  assert.equal(settled.json.settledCount, 1);
  const settledBilling = await c('GET', `/reminders/billing/${person.id}?month=1&year=2100`);
  assert.equal(settledBilling.json.grandTotal, 130);
  assert.equal(settledBilling.json.grandTotalPending, 0);
  assert.equal(settledBilling.json.cards[0].items[0].balanceDue, 0);
  assert.equal((await c('POST', '/reminders/settle-person-month', { personId: 999999, month: 1, year: 2100 })).status, 404);
  assert.equal((await c('POST', '/reminders/settle-person-month', { personId: person.id, month: 13, year: 2100 })).status, 400);

  const monthly = await c('GET', '/reminders/monthly-summary?month=1&year=2100');
  assert.equal(monthly.status, 200);
  assert.equal(monthly.json.people.length, 1);
  assert.equal(monthly.json.people[0].person.id, person.id);
  assert.equal((await c('GET', '/reminders/billing/999999?month=1&year=2100')).status, 404);
});

test('alertas listam faturas próximas e despesas da planilha ainda pendentes', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const userId = db.prepare("SELECT id FROM users WHERE email = 'demo@local.dev'").get().id;
  const person = (await c('POST', '/people', { name: 'Pessoa alertas' })).json.data;
  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const card = (await c('POST', '/cards', {
    name: 'Cartão alertas',
    limit: 1000,
    dueDay: today.getDate(),
  })).json.data;
  const purchaseId = db.prepare(
    'INSERT INTO purchases (user_id, description, person_id, card_id, total, installments_count) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, 'Compra para alerta', person.id, card.id, 120, 1).lastInsertRowid;
  const installmentId = db.prepare(
    'INSERT INTO installments (user_id, purchase_id, number, year, month, amount) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, purchaseId, 1, year, month, 120).lastInsertRowid;
  const sheetId = db.prepare(
    'INSERT INTO budget_sheets (user_id, person_id, year) VALUES (?, ?, ?)',
  ).run(userId, person.id, year).lastInsertRowid;
  const rowId = db.prepare(
    "INSERT INTO budget_rows (user_id, sheet_id, section, label) VALUES (?, ?, 'housing', 'Energia')",
  ).run(userId, sheetId).lastInsertRowid;
  db.prepare('INSERT INTO budget_cells (row_id, user_id, month, value) VALUES (?, ?, ?, ?)').run(rowId, userId, month, 80);

  const result = await c('GET', '/reminders/alerts');
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.totalAlerts, result.json.alerts.length);
  assert.ok(result.json.alerts.some((alert) => alert.type === 'card_invoice' && alert.personName === person.name && alert.status === 'today'));
  assert.ok(result.json.alerts.some((alert) => alert.type === 'monthly_budget' && alert.personName === person.name && alert.amount === 80));

  const payment = await c('PATCH', `/purchases/installments/${installmentId}`, { paid: true });
  assert.equal(payment.status, 200);
  const afterPayment = await c('GET', '/reminders/alerts');
  assert.equal(afterPayment.status, 200);
  assert.equal(afterPayment.json.alerts.some((alert) => alert.type === 'card_invoice' && alert.personName === person.name), false);
  assert.equal(afterPayment.json.alerts.some((alert) => alert.type === 'monthly_budget' && alert.personName === person.name), true);

  const settlement = await c('POST', '/reminders/settle-person-month', { personId: person.id, month, year });
  assert.equal(settlement.status, 200);
  assert.equal(settlement.json.settledCount, 0);
  const cleared = await c('GET', '/reminders/alerts');
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.alerts.some((alert) => alert.personName === person.name), false);
  db.prepare('DELETE FROM purchases WHERE id = ?').run(purchaseId);
  db.prepare('DELETE FROM budget_sheets WHERE id = ?').run(sheetId);
  await c('DELETE', `/cards/${card.id}`);
  await c('DELETE', `/people/${person.id}`);
});

test('isolamento entre usuários (RLS na aplicação)', async () => {
  const demo = client();
  await demo('POST', '/auth/local');
  const demoPurchase = (await demo('GET', '/purchases?pageSize=1')).json.data[0];

  const other = client();
  const reg = await other('POST', '/auth/register', { name: 'Pessoa de teste', email: 'person@example.invalid', password: 'senha-forte-123' });
  assert.equal(reg.status, 201);
  assert.equal((await other('GET', `/purchases/${demoPurchase.id}`)).status, 404);
  assert.equal((await other('DELETE', `/purchases/${demoPurchase.id}`)).status, 404);
  const mine = (await other('GET', '/people')).json.data;
  assert.deepEqual(mine.map((p) => p.name), ['Pessoa de teste']);
  const bad = await other('POST', '/purchases', { description: 'x', personId: demoPurchase.personId, cardId: demoPurchase.cardId, total: 10, count: 1, startMonth: 1, startYear: 2026 });
  assert.equal(bad.status, 400); // não pode usar pessoa/cartão de outro usuário
});

test('validação, login errado e rota inexistente', async () => {
  const c = client();
  assert.equal((await c('POST', '/auth/register', { name: 'a', email: 'x', password: '1' })).json.error.code, 'VALIDATION_ERROR');
  assert.equal((await c('POST', '/auth/login', { email: 'invalid@example.invalid', password: 'qualquer123' })).status, 401);
  assert.equal((await c('GET', '/nada')).status, 401); // sem login
  await c('POST', '/auth/local');
  assert.equal((await c('GET', '/nada')).status, 404); // logado
});

test('rescisão: mesmas fórmulas da planilha', () => {
  const r = calcRescission({ salary: 3000, admission: '2024-01-01', dismissal: '2026-03-10', reason: 'Sem justa causa', notice: 'Trabalhado', fgtsBalance: 2000 });
  const v = Object.fromEntries(r.items.map((i) => [i.key, i.value]));
  assert.equal(v.salaryBalance, 1000);
  assert.equal(v.thirteenth, 500);
  assert.equal(v.vacation, 666.67);
  assert.equal(v.fgtsFine, 800);
  assert.equal(v.notice, 0);
  assert.equal(r.total, 2966.67);
  assert.equal(r.fgtsBalance, 2000);
  assert.equal(r.totalToReceive, 4966.67);
});

test('visão geral retorna 12 meses e coleções de dados sintéticos', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const people = (await c('GET', '/people')).json.data;
  const person = people.find((item) => item.name === 'Pessoa 01');
  const response = await c('GET', `/dashboard/person-overview?personId=${person.id}&year=2026`);
  assert.equal(response.status, 200);
  assert.equal(response.json.data.totals.length, 12);
  assert.equal(response.json.data.status.length, 12);
  assert.ok(Array.isArray(response.json.data.cards));
  assert.ok(Array.isArray(response.json.data.fixed));
});

test('painel e orçamento aceitam períodos sem dados cadastrados', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const people = (await c('GET', '/people')).json.data;
  const person = people.find((item) => item.name === 'Pessoa 01');
  const summary = await c('GET', '/dashboard/summary?month=1&year=2027');
  assert.equal(summary.status, 200);
  assert.equal(typeof summary.json.data.totals.month, 'number');
  const budget = await c('GET', `/budgets?personId=${person.id}&year=2027`);
  assert.equal(budget.status, 200);
  assert.ok(Array.isArray(budget.json.data.sections));
});

test('resumo do orçamento mantém a soma mensal consistente', async () => {
  const c = client();
  await c('POST', '/auth/local');
  const people = (await c('GET', '/people')).json.data;
  const person = people.find((item) => item.name === 'Pessoa 01');
  const budget = (await c('GET', `/budgets?personId=${person.id}&year=2026`)).json.data;
  const spent = budget.summary.lines.find((line) => line.key === 'spent').values;
  const balance = budget.summary.lines.find((line) => line.key === 'balance').values;
  const revenue = budget.summary.lines.find((line) => line.key === 'revenue').values;
  for (let month = 0; month < 12; month += 1) {
    assert.equal(Math.round((revenue[month] - spent[month]) * 100), Math.round(balance[month] * 100));
  }
});

// ───────────── Compras compartilhadas ─────────────

test('splitAmount: divide em centavos sem perder nem criar dinheiro', () => {
  assert.deepEqual(splitAmount(130, 2), [65, 65]);
  assert.deepEqual(splitAmount(130, 3), [43.34, 43.33, 43.33]);
  assert.deepEqual(splitAmount(130, 3, 1), [43.33, 43.34, 43.33]); // o centavo a mais gira
  for (const [amount, n] of [[130, 3], [0.1, 3], [100, 7], [300, 3], [99.99, 4]]) {
    assert.equal(Math.round(splitAmount(amount, n).reduce((a, b) => a + b, 0) * 100), Math.round(amount * 100));
  }
  const sched = buildSharedSchedule({ total: 120, count: 3, startYear: 2026, startMonth: 11 }, 3);
  assert.equal(sched.length, 3);
  for (const s of sched) assert.equal(Math.round(s.shares.reduce((a, b) => a + b, 0) * 100), Math.round(s.amount * 100));
});

async function sharedSetup(email) {
  const c = client();
  assert.equal((await c('POST', '/auth/register', { name: 'Pessoa de demonstração', email, password: 'senha-forte-123' })).status, 201);
  const mk = async (name) => (await c('POST', '/people', { name })).json.data.id;
  const personOne = await mk('Pessoa 01');
  const personTwo = await mk('Pessoa 02');
  const personThree = await mk('Pessoa 03');
  const card = (await c('POST', '/cards', { name: 'Cartao de exemplo', limit: 5000 })).json.data.id;
  return { c, personOne, personTwo, personThree, card };
}

test('compra compartilhada de demonstração cria parcelas e rateia o total entre participantes', async () => {
  const { c, personOne, personTwo, personThree, card } = await sharedSetup('group3@teste.com');
  const res = await c('POST', '/purchases/shared', { description: 'Compra de demonstração', cardId: card, total: 120, count: 3, startMonth: 11, startYear: 2026, participantIds: [personOne, personTwo, personThree] });
  assert.equal(res.status, 201);
  const purchase = res.json.data;
  assert.equal(purchase.total, 120);
  assert.equal(purchase.perInstallment, 40);
  assert.equal(purchase.participants.length, 3);
  assert.equal(purchase.installments.length, 3);
  assert.deepEqual(purchase.last, { year: 2027, month: 1 });
  assert.equal(purchase.participants.reduce((a, p) => a + p.total, 0), 120);

  for (const installment of purchase.installments) {
    assert.equal(Math.round(installment.shares.reduce((a, s) => a + s.amount, 0) * 100), 4000);
    for (const share of installment.shares) assert.ok(share.amount === 13.33 || share.amount === 13.34);
  }
  const dash = (await c('GET', '/dashboard/summary?month=11&year=2026')).json.data;
  assert.equal(dash.totals.month, 40);
  assert.equal(dash.cardTotals.find((x) => x.name === 'Cartao de exemplo').amount, 40);
  for (const p of dash.people) assert.ok(p.month === 13.33 || p.month === 13.34);
  assert.equal(dash.people.reduce((a, p) => a + p.owed, 0), 120);
  const after = (await c('GET', '/dashboard/summary?month=2&year=2027')).json.data;
  assert.equal(after.totals.month, 0);
  assert.equal(after.people.reduce((a, p) => a + p.owed, 0), 0);
});

test('compra compartilhada entre duas pessoas preserva parcelas pagas ao editar', async () => {
  const { c, personOne, personTwo, personThree, card } = await sharedSetup('group2@teste.com');
  const body = { description: 'Compra de demonstração', cardId: card, total: 120, count: 3, startMonth: 1, startYear: 2027 };
  const purchase = (await c('POST', '/purchases/shared', { ...body, participantIds: [personOne, personTwo] })).json.data;
  assert.deepEqual(purchase.installments[0].shares.map((s) => s.amount), [20, 20]);

  const personTwoShare = purchase.installments[0].shares.find((s) => s.personId === personTwo);
  assert.equal((await c('PATCH', `/purchases/installments/${personTwoShare.installmentId}`, { paid: true })).status, 200);

  const upd = await c('PUT', `/purchases/shared/${purchase.group}`, { ...body, participantIds: [personOne, personTwo, personThree] });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.data.participants.length, 3);
  assert.equal(upd.json.data.installments.length, 3);
  assert.equal(upd.json.data.installments[0].shares.find((s) => s.personId === personTwo).paid, true);
  assert.equal(upd.json.data.installments[1].shares.find((s) => s.personId === personTwo).paid, false);
  assert.equal(upd.json.data.total, 120);

  const all = (await c('GET', '/purchases')).json.data;
  assert.equal(all.length, 1);
  assert.equal(all[0].total, 120);
  assert.equal(all[0].shared, true);
  const mine = (await c('GET', `/purchases?personId=${personThree}`)).json.data;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].total, 40);
  const month = (await c('GET', '/purchases/installments?month=1&year=2027')).json;
  assert.equal(month.data.length, 3);
  assert.equal(month.total, 40);
  assert.ok(month.data.every((r) => r.sharedGroup === purchase.group && r.sharedWith));

  assert.equal((await c('DELETE', `/purchases/shared/${purchase.group}`)).status, 204);
  assert.equal((await c('GET', '/purchases')).json.total, 0);
  assert.equal((await c('GET', `/purchases/shared/${purchase.group}`)).status, 404);
});

test('compra compartilhada: validações e proteção das compras do grupo', async () => {
  const { c, personOne, personTwo, card } = await sharedSetup('group-validation@teste.com');
  const body = { description: 'Compra de demonstração', cardId: card, total: 120, count: 3, startMonth: 1, startYear: 2027 };
  assert.equal((await c('POST', '/purchases/shared', { ...body, participantIds: [personOne] })).status, 400);
  assert.equal((await c('POST', '/purchases/shared', { ...body, participantIds: [personOne, personOne] })).status, 400);
  assert.equal((await c('POST', '/purchases/shared', { ...body, total: 0.01, participantIds: [personOne, personTwo] })).status, 400);

  const purchase = (await c('POST', '/purchases/shared', { ...body, participantIds: [personOne, personTwo] })).json.data;
  const memberId = purchase.participants[0].purchaseId;
  // a fatia individual não pode ser editada/excluída isoladamente (deixaria o grupo inconsistente)
  const put = await c('PUT', `/purchases/${memberId}`, { description: 'x', personId: personOne, cardId: card, total: 10, count: 1, startMonth: 1, startYear: 2027 });
  assert.equal(put.status, 400);
  assert.equal((await c('DELETE', `/purchases/${memberId}`)).status, 400);

  // outro usuário não enxerga nem mexe no grupo, nem usa pessoas de outro usuário
  const other = client();
  await other('POST', '/auth/register', { name: 'Outra conta', email: 'outra-group@teste.com', password: 'senha-forte-123' });
  assert.equal((await other('GET', `/purchases/shared/${purchase.group}`)).status, 404);
  assert.equal((await other('DELETE', `/purchases/shared/${purchase.group}`)).status, 404);
  const mine = (await other('GET', '/people')).json.data[0].id;
  const oCard = (await other('POST', '/cards', { name: 'X', limit: 1 })).json.data.id;
  assert.equal((await other('POST', '/purchases/shared', { ...body, cardId: oCard, participantIds: [mine, personOne] })).status, 400);
});

test('banco antigo (sem shared_group) é migrado sozinho ao abrir, sem perder dados', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-mig-'));
  const file = path.join(dir, 'old.db');
  try {
    // simula o banco de uma versão anterior: tabela purchases sem a coluna nova
    const old = openDb(file);
    old.prepare("INSERT INTO users (email, name) VALUES ('a@a.com', 'A')").run();
    old.prepare("INSERT INTO people (user_id, name) VALUES (1, 'A')").run();
    old.prepare("INSERT INTO cards (user_id, name) VALUES (1, 'C')").run();
    old.prepare("INSERT INTO purchases (user_id, description, person_id, card_id, total, installments_count) VALUES (1, 'Antiga', 1, 1, 100, 2)").run();
    old.exec('DROP INDEX idx_purch_shared; ALTER TABLE purchases DROP COLUMN shared_group; ALTER TABLE people DROP COLUMN phone; ALTER TABLE cards DROP COLUMN due_day; ALTER TABLE cards DROP COLUMN closing_day');
    assert.ok(!old.prepare('PRAGMA table_info(purchases)').all().some((c) => c.name === 'shared_group'));
    assert.ok(!old.prepare('PRAGMA table_info(people)').all().some((c) => c.name === 'phone'));
    assert.ok(!old.prepare('PRAGMA table_info(cards)').all().some((c) => c.name === 'due_day'));
    assert.ok(!old.prepare('PRAGMA table_info(cards)').all().some((c) => c.name === 'closing_day'));
    old.close();

    const migrated = openDb(file);
    assert.ok(migrated.prepare('PRAGMA table_info(purchases)').all().some((c) => c.name === 'shared_group'));
    assert.ok(migrated.prepare('PRAGMA table_info(people)').all().some((c) => c.name === 'phone'));
    assert.equal(migrated.prepare('SELECT due_day, closing_day FROM cards WHERE id = 1').get().due_day, 10);
    assert.equal(migrated.prepare('SELECT due_day, closing_day FROM cards WHERE id = 1').get().closing_day, 3);
    const row = migrated.prepare('SELECT description, shared_group FROM purchases').get();
    assert.deepEqual({ ...row }, { description: 'Antiga', shared_group: null });
    migrated.prepare('UPDATE people SET share_token = ? WHERE id = 1').run('a'.repeat(64));
    migrated.close();
    const shortened = openDb(file);
    const token = shortened.prepare('SELECT share_token FROM people WHERE id = 1').get().share_token;
    assert.match(token, /^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    shortened.close();
    openDb(file).close(); // abrir de novo não pode falhar (migração idempotente)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('splitWeighted: partes desiguais fecham no centavo', () => {
  assert.deepEqual(splitWeighted(130, [50, 25, 25]), [65, 32.5, 32.5]);
  assert.deepEqual(splitWeighted(130, [7000, 3000]), [91, 39]);
  for (const [amount, w] of [[120, [1, 1, 1]], [100, [3333, 3333, 3334]], [99.99, [60, 30, 10]], [0.05, [90, 10]], [234.56, [1, 2, 4, 8]]]) {
    assert.equal(Math.round(splitWeighted(amount, w).reduce((a, b) => a + b, 0) * 100), Math.round(amount * 100));
  }
});

test('compra compartilhada com divisão escolhida: por porcentagem e por valor', async () => {
  const { c, personOne, personTwo, personThree, card } = await sharedSetup('group-custom@teste.com');
  const base = { description: 'Compra de demonstração', cardId: card, total: 120, count: 3, startMonth: 1, startYear: 2027 };

  const pct = await c('POST', '/purchases/shared', { ...base, splitMode: 'percent', participants: [{ personId: personOne, value: 50 }, { personId: personTwo, value: 30 }, { personId: personThree, value: 20 }] });
  assert.equal(pct.status, 201);
  const purchase = pct.json.data;
  assert.deepEqual(purchase.installments[0].shares.map((x) => x.amount), [20, 12, 8]);
  assert.deepEqual(purchase.participants.map((x) => x.total), [60, 36, 24]);
  assert.deepEqual(purchase.participants.map((x) => x.percent), [50, 30, 20]);
  assert.equal(purchase.installments.length, 3);

  const upd = await c('PUT', `/purchases/shared/${purchase.group}`, { ...base, splitMode: 'amount', participants: [{ personId: personOne, value: 80 }, { personId: personTwo, value: 40 }] });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.json.data.participants.map((x) => x.total), [80, 40]);
  assert.deepEqual(upd.json.data.installments[0].shares.map((x) => x.amount), [26.67, 13.33]);

  const dash = (await c('GET', '/dashboard/summary?month=1&year=2027')).json.data;
  assert.equal(dash.people.find((p) => p.id === personOne).month, 26.67);
  assert.equal(dash.people.find((p) => p.id === personTwo).month, 13.33);
  assert.equal(dash.totals.month, 40);
});

test('compra compartilhada com divisão escolhida: validações', async () => {
  const { c, personOne, personTwo, personThree, card } = await sharedSetup('group-custom-validation@teste.com');
  const base = { description: 'Compra de demonstração', cardId: card, total: 120, count: 3, startMonth: 1, startYear: 2027 };
  const post = (b) => c('POST', '/purchases/shared', { ...base, ...b });
  const two = (a, b, mode) => ({ splitMode: mode, participants: [{ personId: personOne, value: a }, { personId: personTwo, value: b }] });
  assert.equal((await post(two(60, 30, 'percent'))).status, 400); // soma 90%
  assert.equal((await post(two(70, 40, 'percent'))).status, 400); // soma 110%
  assert.equal((await post(two(80, 30, 'amount'))).status, 400); // soma difere do total
  assert.equal((await post({ splitMode: 'percent', participants: [{ personId: personOne, value: 100 }, { personId: personTwo }] })).status, 400); // falta valor
  assert.equal((await post({ splitMode: 'percent', participants: [{ personId: personOne, value: 50 }, { personId: personOne, value: 50 }] })).status, 400); // repetido
  assert.equal((await post({ splitMode: 'percent', participants: [{ personId: personOne, value: 100 }] })).status, 400); // só um
  assert.equal((await post(two(100, 0, 'percent'))).status, 400); // parte zero
  assert.equal((await post(two(50, 50, 'percent'))).status, 201);
  assert.equal((await post({ participants: [{ personId: personTwo }, { personId: personThree }] })).status, 201); // sem splitMode = igual
});

test('limpezas das configurações exigem login e removem os dados certos', async () => {
  const anonymous = client();
  assert.equal((await anonymous('POST', '/system/reset-purchases')).status, 401);

  const c = client();
  assert.equal((await c('POST', '/auth/local')).status, 200);
  const user = (await c('GET', '/auth/me')).json.data.user;
  const personName = `Reset test ${Date.now()}`;
  const cardName = `Reset card ${Date.now()}`;
  db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(user.id, personName);
  db.prepare('INSERT INTO cards (user_id, name) VALUES (?, ?)').run(user.id, cardName);

  assert.equal((await c('POST', '/system/reset-purchases')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM people WHERE user_id = ? AND name = ?').get(user.id, personName).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cards WHERE user_id = ? AND name = ?').get(user.id, cardName).count, 1);

  assert.equal((await c('POST', '/system/reset-all')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM people WHERE user_id = ? AND name = ?').get(user.id, personName).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cards WHERE user_id = ? AND name = ?').get(user.id, cardName).count, 0);
});
