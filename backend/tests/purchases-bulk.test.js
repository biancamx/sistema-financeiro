import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createPurchasesService } from '../src/modules/purchases/purchases.service.js';

test('bulk payment marks owned installments paid and releases card limit atomically', () => {
  const db = openDb(':memory:');
  try {
    const userId = Number(db.prepare(
      "INSERT INTO users (name, email) VALUES ('Bulk test', 'bulk-payment@example.com')",
    ).run().lastInsertRowid);
    const otherUserId = Number(db.prepare(
      "INSERT INTO users (name, email) VALUES ('Other user', 'bulk-payment-other@example.com')",
    ).run().lastInsertRowid);
    const personId = Number(db.prepare(
      "INSERT INTO people (user_id, name) VALUES (?, 'Person')",
    ).run(userId).lastInsertRowid);
    const cardId = Number(db.prepare(
      "INSERT INTO cards (user_id, name, limit_amount) VALUES (?, 'Card', 1000)",
    ).run(userId).lastInsertRowid);
    const purchaseId = Number(db.prepare(
      `INSERT INTO purchases (user_id, description, person_id, card_id, total, installments_count)
       VALUES (?, 'Purchase', ?, ?, 300, 3)`,
    ).run(userId, personId, cardId).lastInsertRowid);
    const otherPurchaseId = Number(db.prepare(
      `INSERT INTO purchases (user_id, description, person_id, card_id, total, installments_count)
       VALUES (?, 'Other purchase', ?, ?, 100, 1)`,
    ).run(otherUserId, Number(db.prepare(
      "INSERT INTO people (user_id, name) VALUES (?, 'Other person')",
    ).run(otherUserId).lastInsertRowid), Number(db.prepare(
      "INSERT INTO cards (user_id, name, limit_amount) VALUES (?, 'Other card', 500)",
    ).run(otherUserId).lastInsertRowid)).lastInsertRowid);
    const insertInstallment = db.prepare(
      `INSERT INTO installments (user_id, purchase_id, number, year, month, amount)
       VALUES (?, ?, ?, 2026, ?, ?)`,
    );
    const firstId = Number(insertInstallment.run(userId, purchaseId, 1, 10, 100).lastInsertRowid);
    const secondId = Number(insertInstallment.run(userId, purchaseId, 2, 11, 100).lastInsertRowid);
    const otherId = Number(insertInstallment.run(otherUserId, otherPurchaseId, 1, 10, 100).lastInsertRowid);
    db.prepare('UPDATE installments SET paid_amount = 25 WHERE id = ?').run(firstId);
    const service = createPurchasesService(db);

    const usedBefore = db.prepare(
      `SELECT SUM(MAX(i.amount - i.paid_amount, 0)) AS used FROM installments i
       JOIN purchases p ON p.id = i.purchase_id WHERE p.card_id = ?`,
    ).get(cardId).used;
    assert.equal(usedBefore, 175);

    assert.throws(() => service.setManyPaid(userId, [firstId, otherId]), /não foram encontradas/);
    assert.equal(db.prepare('SELECT paid FROM installments WHERE id = ?').get(firstId).paid, 0);

    assert.deepEqual(service.setManyPaid(userId, [firstId, secondId]), { updated: 2 });
    assert.equal(db.prepare('SELECT SUM(paid) AS paid FROM installments WHERE purchase_id = ?').get(purchaseId).paid, 2);
    assert.equal(db.prepare(
      `SELECT SUM(MAX(i.amount - i.paid_amount, 0)) AS used FROM installments i
       JOIN purchases p ON p.id = i.purchase_id WHERE p.card_id = ?`,
    ).get(cardId).used, 0);

    assert.deepEqual(service.setManyPaid(userId, [firstId, secondId], false), { updated: 2 });
    assert.deepEqual(db.prepare(
      'SELECT paid, paid_amount FROM installments WHERE purchase_id = ? ORDER BY number',
    ).all(purchaseId).map((row) => [row.paid, row.paid_amount]), [[0, 0], [0, 0]]);
    assert.equal(db.prepare(
      `SELECT SUM(MAX(i.amount - i.paid_amount, 0)) AS used FROM installments i
       JOIN purchases p ON p.id = i.purchase_id WHERE p.card_id = ?`,
    ).get(cardId).used, 200);
  } finally {
    db.close();
  }
});

test('bulk payment API requires a session and immediately restores available card limit', async () => {
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_LOCAL_LOGIN = 'true';
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.AUTH_RATE_LIMIT_MAX = '100000';
  const [{ createApp }, { openDb: openTestDb }] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/index.js'),
  ]);
  const db = openTestDb(':memory:');
  const server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const anonymous = await fetch(`${base}/purchases/installments/pay-selected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1] }),
    });
    assert.equal(anonymous.status, 401);

    const login = await fetch(`${base}/auth/local`, { method: 'POST' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const profile = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } }).then((response) => response.json());
    const userId = profile.data.user.id;
    const personId = Number(db.prepare(
      'INSERT INTO people (user_id, name) VALUES (?, ?)',
    ).run(userId, 'API bulk person').lastInsertRowid);
    const cardId = Number(db.prepare(
      'INSERT INTO cards (user_id, name, limit_amount) VALUES (?, ?, ?)',
    ).run(userId, 'API bulk card', 1000).lastInsertRowid);
    const purchaseId = Number(db.prepare(
      `INSERT INTO purchases (user_id, description, person_id, card_id, total, installments_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(userId, 'API bulk purchase', personId, cardId, 200, 2).lastInsertRowid);
    const insertInstallment = db.prepare(
      `INSERT INTO installments (user_id, purchase_id, number, year, month, amount)
       VALUES (?, ?, ?, 2026, 10, 100)`,
    );
    const ids = [
      Number(insertInstallment.run(userId, purchaseId, 1).lastInsertRowid),
      Number(insertInstallment.run(userId, purchaseId, 2).lastInsertRowid),
    ];

    const before = await fetch(`${base}/cards?month=10&year=2026`, { headers: { Cookie: cookie } }).then((response) => response.json());
    assert.equal(before.data.find((card) => card.id === cardId).used, 200);

    const response = await fetch(`${base}/purchases/installments/pay-selected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { updated: 2 });

    const after = await fetch(`${base}/cards?month=10&year=2026`, { headers: { Cookie: cookie } }).then((res) => res.json());
    const card = after.data.find((item) => item.id === cardId);
    assert.equal(card.used, 0);
    assert.equal(card.available, 1000);

    const unpayResponse = await fetch(`${base}/purchases/installments/unpay-selected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids }),
    });
    assert.equal(unpayResponse.status, 200);
    assert.deepEqual((await unpayResponse.json()).data, { updated: 2 });
    const unpaidCard = await fetch(`${base}/cards?month=10&year=2026`, { headers: { Cookie: cookie } }).then((res) => res.json());
    const restoredCard = unpaidCard.data.find((item) => item.id === cardId);
    assert.equal(restoredCard.used, 200);
    assert.equal(restoredCard.available, 800);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  }
});
