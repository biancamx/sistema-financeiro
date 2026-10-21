import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';

test('limite e faturas refletem parcelas em aberto imediatamente em cartões, painel e visão geral', async () => {
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_LOCAL_LOGIN = 'true';
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.AUTH_RATE_LIMIT_MAX = '100000';
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };

  try {
    assert.equal((await request('POST', '/auth/local')).status, 200);
    const userId = (await request('GET', '/auth/me')).json.data.user.id;
    const personId = Number(db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, 'Limites').lastInsertRowid);
    const secondPersonId = Number(db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, 'Participante').lastInsertRowid);
    const cardA = Number(db.prepare('INSERT INTO cards (user_id, name, limit_amount) VALUES (?, ?, ?)').run(userId, 'Cartão A', 50).lastInsertRowid);
    const cardB = Number(db.prepare('INSERT INTO cards (user_id, name, limit_amount) VALUES (?, ?, ?)').run(userId, 'Cartão B', 100).lastInsertRowid);
    const purchases = db.prepare(
      'INSERT INTO purchases (user_id, description, person_id, card_id, total, installments_count) VALUES (?, ?, ?, ?, ?, 1)',
    );
    const installments = db.prepare(
      'INSERT INTO installments (user_id, purchase_id, number, year, month, amount, paid, paid_amount) VALUES (?, ?, 1, ?, ?, ?, ?, ?)',
    );
    const addInstallment = (cardId, description, year, month, amount, paid = 0, paidAmount = 0) => {
      const purchaseId = Number(purchases.run(userId, description, personId, cardId, amount).lastInsertRowid);
      return Number(installments.run(userId, purchaseId, year, month, amount, paid, paidAmount).lastInsertRowid);
    };
    addInstallment(cardA, 'Parcela antiga', 2026, 9, 90);
    const currentA = addInstallment(cardA, 'Parcela parcial', 2026, 10, 25.25, 0, 5.05);
    const futureA = addInstallment(cardA, 'Parcela futura', 2026, 11, 60.60);
    const currentB = addInstallment(cardB, 'Outro cartão', 2026, 10, 30.30);
    addInstallment(cardB, 'Pago legado', 2026, 10, 5, 1, 0);

    const getCards = async () => (await request('GET', '/cards?month=10&year=2026')).json.data;
    const getDashboard = async () => (await request('GET', '/dashboard/summary?month=10&year=2026')).json.data;
    const initialCards = await getCards();
    assert.deepEqual(
      initialCards.filter((card) => card.id === cardA || card.id === cardB).map((card) => [card.id, card.used, card.available, card.invoice]),
      [[cardA, 80.8, -30.8, 20.2], [cardB, 30.3, 69.7, 30.3]],
    );
    const initialDashboard = await getDashboard();
    assert.equal(initialDashboard.totals.month, 50.5);
    assert.equal(initialDashboard.totals.owed, 111.1);
    assert.equal(initialDashboard.cardTotals.find((card) => card.id === cardA).used, 80.8);
    assert.equal(initialDashboard.cardTotals.find((card) => card.id === cardA).available, -30.8);
    assert.equal(initialDashboard.person.cards.find((card) => card.id === cardA).amount, 20.2);

    const overview = (await request('GET', `/dashboard/person-overview?personId=${personId}&year=2026`)).json.data;
    assert.equal(overview.cards.find((card) => card.id === cardA).values[9], 20.2);
    assert.equal(overview.cards.find((card) => card.id === cardA).values[8], 90);

    assert.equal((await request('PATCH', `/purchases/installments/${currentA}`, { paid: true })).status, 200);
    const afterSingle = await getCards();
    assert.equal(afterSingle.find((card) => card.id === cardA).used, 60.6);
    assert.equal(afterSingle.find((card) => card.id === cardA).invoice, 0);
    const dashboardAfterSingle = await getDashboard();
    assert.equal(dashboardAfterSingle.totals.month, 30.3);
    assert.equal(dashboardAfterSingle.totals.owed, 90.9);

    assert.equal((await request('PATCH', `/purchases/installments/${currentA}`, { paid: false })).status, 200);
    assert.equal((await getCards()).find((card) => card.id === cardA).used, 85.85);
    assert.equal((await request('PATCH', `/purchases/installments/${currentA}`, { paid: true })).status, 200);
    assert.equal((await getCards()).find((card) => card.id === cardA).used, 60.6);

    assert.equal((await request('POST', '/purchases/installments/pay-selected', { ids: [futureA, currentB] })).status, 200);
    const afterBulk = await getCards();
    assert.equal(afterBulk.find((card) => card.id === cardA).used, 0);
    assert.equal(afterBulk.find((card) => card.id === cardB).used, 0);
    assert.equal((await getDashboard()).totals.owed, 0);
    const overviewAfterBulk = (await request('GET', `/dashboard/person-overview?personId=${personId}&year=2026`)).json.data;
    assert.equal(overviewAfterBulk.cards.find((card) => card.id === cardA).values[10], 0);

    assert.equal((await request('POST', '/purchases/installments/unpay-selected', { ids: [currentA, futureA, currentB] })).status, 200);
    const afterUnpay = await getCards();
    assert.equal(afterUnpay.find((card) => card.id === cardA).used, 85.85);
    assert.equal(afterUnpay.find((card) => card.id === cardB).used, 30.3);

    const purchaseBody = {
      description: 'Compra criada pela API',
      categoryId: null,
      observation: 'Guardar comprovante',
      personId,
      cardId: cardB,
      total: 10,
      count: 1,
      startMonth: 10,
      startYear: 2026,
    };
    const created = await request('POST', '/purchases', purchaseBody);
    assert.equal(created.status, 201);
    assert.equal(created.json.data.observation, 'Guardar comprovante');
    assert.equal((await getCards()).find((card) => card.id === cardB).used, 40.3);
    const sheet = (await request('GET', `/budgets?personId=${personId}&year=2026&month=10`)).json.data;
    const monthlyPurchase = sheet.monthly.purchases.find((purchase) => purchase.purchaseId === created.json.data.id);
    assert.equal(monthlyPurchase.observation, 'Guardar comprovante');
    assert.equal(sheet.monthly.cards.find((card) => card.id === cardB).total, 45.3);
    assert.equal(sheet.monthly.categories.find((category) => category.name === 'Sem categoria').total, 70.55);
    assert.equal(sheet.sections.find((section) => section.key === 'cards').totals[9], 70.55);
    assert.equal((await request('PATCH', `/purchases/${created.json.data.id}/observation`, { observation: 'Nota atualizada' })).status, 200);
    const updatedSheet = (await request('GET', `/budgets?personId=${personId}&year=2026&month=10`)).json.data;
    assert.equal(updatedSheet.monthly.purchases.find((purchase) => purchase.purchaseId === created.json.data.id).observation, 'Nota atualizada');
    const shared = await request('POST', '/purchases/shared', {
      description: 'Compra compartilhada com observação',
      observation: 'Garantia do produto',
      categoryId: null,
      cardId: cardA,
      total: 20,
      count: 1,
      startMonth: 12,
      startYear: 2026,
      splitMode: 'equal',
      participants: [{ personId }, { personId: secondPersonId }],
    });
    assert.equal(shared.status, 201);
    assert.equal(shared.json.data.observation, 'Garantia do produto');
    assert.equal((await request('PATCH', `/purchases/${shared.json.data.participants[0].purchaseId}/observation`, { observation: 'Comprovante guardado' })).status, 200);
    const sharedAfterNote = await request('GET', `/purchases/shared/${shared.json.data.group}`);
    assert.equal(sharedAfterNote.json.data.observation, 'Comprovante guardado');
    const updated = await request('PUT', `/purchases/${created.json.data.id}`, { ...purchaseBody, total: 20 });
    assert.equal(updated.status, 200);
    assert.equal((await getCards()).find((card) => card.id === cardB).used, 50.3);
    assert.equal((await request('DELETE', `/purchases/${created.json.data.id}`)).status, 204);
    assert.equal((await getCards()).find((card) => card.id === cardB).used, 30.3);

    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const date = `${year}-${String(month).padStart(2, '0')}-10`;
    const rescheduleCard = await request('POST', '/cards', {
      name: 'Cartão recálculo', limit: 500, closingDay: 10, dueDay: 5,
    });
    assert.equal(rescheduleCard.status, 201);
    const reschedulePurchase = await request('POST', '/purchases', {
      description: 'Compra após fechamento', personId, cardId: rescheduleCard.json.data.id,
      purchaseDate: date, total: 80, count: 1, startMonth: month, startYear: year,
    });
    assert.equal(reschedulePurchase.status, 201);
    const nextMonthIndex = year * 12 + month;
    assert.equal(
      reschedulePurchase.json.data.first.month,
      (nextMonthIndex % 12) + 1,
    );
    const updatedCard = await request('PUT', `/cards/${rescheduleCard.json.data.id}`, {
      ...rescheduleCard.json.data, closingDay: 11,
    });
    assert.equal(updatedCard.status, 200);
    const recalculated = await request('GET', `/purchases/${reschedulePurchase.json.data.id}`);
    assert.equal(recalculated.json.data.first.month, month);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
