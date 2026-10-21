import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
import { openDb } from '../src/db/index.js';
import { createCashLedgerService, generateCashSchedule } from '../src/modules/cashLedger/cashLedger.service.js';
const { createApp } = await import('../src/app.js');

function fixture() {
  const db = openDb(':memory:');
  const userId = Number(db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(`cash-${Date.now()}@example.com`, 'Cash test').lastInsertRowid);
  const personId = Number(db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, 'Comprador').lastInsertRowid);
  const secondPersonId = Number(db.prepare('INSERT INTO people (user_id, name) VALUES (?, ?)').run(userId, 'Devedor').lastInsertRowid);
  const categoryId = Number(db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(userId, 'Alimentação').lastInsertRowid);
  const vehicleId = Number(db.prepare("INSERT INTO vehicles (user_id, model, plate) VALUES (?, ?, ?)").run(userId, 'Moto teste', 'ABC1234').lastInsertRowid);
  const cardId = Number(db.prepare('INSERT INTO cards (user_id, name, limit_amount) VALUES (?, ?, ?)').run(userId, 'Cartão intocado', 500).lastInsertRowid);
  return { db, userId, personId, secondPersonId, categoryId, vehicleId, cardId, service: createCashLedgerService(db) };
}

const today = () => new Date().toISOString().slice(0, 10);
const offsetDate = (days) => {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sale = (personId, changes = {}) => ({
  kind: 'sale', description: 'Moto', total: 8000, personId, entryDate: '2026-10-05',
  paymentMethod: 'pix', downPayment: 2000, installmentCount: 6, firstDueDate: '2026-11-10',
  frequency: 'monthly', notes: '', ...changes,
});

test('geração de parcelas usa centavos exatos e limita datas ao último dia do mês', () => {
  assert.deepEqual(generateCashSchedule({ totalCents: 10000, count: 3, firstDueDate: '2026-10-10' }).map((item) => item.amountCents), [3334, 3333, 3333]);
  assert.deepEqual(generateCashSchedule({ totalCents: 300, count: 3, firstDueDate: '2026-01-31' }).map((item) => item.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(generateCashSchedule({ totalCents: 300, count: 3, firstDueDate: '2026-10-21', frequency: 'weekly' }).map((item) => item.dueDate), ['2026-10-21', '2026-10-28', '2026-11-04']);
});

test('compra avulsa, venda, pagamentos parciais, empréstimo, reembolso, atrasos e caixa de veículo', () => {
  const context = fixture();
  const { db, service, userId, personId, secondPersonId, categoryId, vehicleId, cardId } = context;
  try {
    const limitBefore = db.prepare('SELECT limit_amount FROM cards WHERE id = ?').get(cardId).limit_amount;
    const expense = service.create(userId, {
      kind: 'expense', description: 'Açaí', total: 25, entryDate: today(), paymentMethod: 'pix',
      categoryId, notes: '',
    });
    assert.equal(expense.entry.kind, 'expense');
    assert.equal(service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4))).spent, 25);
    assert.equal(db.prepare('SELECT limit_amount FROM cards WHERE id = ?').get(cardId).limit_amount, limitBefore);

    const motorcycle = service.create(userId, sale(personId, { vehicleId }));
    assert.equal(motorcycle.installments.length, 7);
    assert.equal(motorcycle.installments.reduce((sum, item) => sum + item.amountCents, 0), 800000);
    assert.equal(motorcycle.installments[0].amountCents, 200000);
    assert.equal(motorcycle.installments.slice(1).every((item) => item.amountCents === 100000), true);
    assert.equal(service.summary(userId, 10, 2026).totalReceivable, 8000);
    const vehicle = db.prepare('SELECT status, sold_date AS soldDate, sold_value_cents AS soldValueCents FROM vehicles WHERE id = ?').get(vehicleId);
    assert.deepEqual(vehicle, { status: 'sold', soldDate: '2026-10-05', soldValueCents: 800000 });

    const downPayment = motorcycle.installments.find((item) => item.number === 1);
    service.receive(userId, downPayment.installmentId, { amount: 2000, receivedOn: today(), paymentMethod: 'cash' });
    assert.equal(service.summary(userId, 10, 2026).totalReceivable, 6000);

    const secondSaleInstallment = motorcycle.installments.find((item) => item.number === 2);
    service.receive(userId, secondSaleInstallment.installmentId, { amount: 400, receivedOn: today(), paymentMethod: 'pix' });
    let detail = service.get(userId, motorcycle.entry.id);
    assert.equal(detail.installments.find((item) => item.installmentId === secondSaleInstallment.installmentId).status, 'partial');
    assert.equal(detail.installments.find((item) => item.installmentId === secondSaleInstallment.installmentId).outstanding, 600);
    assert.equal(detail.receipts.length, 2);
    assert.equal(service.summary(userId, 10, 2026).totalReceivable, 5600);

    const loan = service.create(userId, {
      kind: 'loan', description: 'Empréstimo sem prazo', total: 500, personId,
      entryDate: today(), paymentMethod: 'pix', installmentCount: 1, loanTerm: 'none',
      firstDueDate: null, interestRate: 0, frequency: 'monthly', notes: '',
    });

    test('API privada cria saída e recebível, lista parcelas e registra recebimento parcial', async () => {
      const db = openDb(':memory:');
      const server = createApp(db).listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      let cookie = '';
      const request = async (method, path, body) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const text = await response.text();
        return { status: response.status, json: text ? JSON.parse(text) : null };
      };
      try {
        assert.equal((await request('POST', '/auth/local')).status, 200);
        const person = await request('POST', '/people', { name: `Avulsos API ${Date.now()}` });
        assert.equal(person.status, 201);
        const expense = await request('POST', '/cash-ledger/entries', {
          kind: 'expense', description: 'Açaí Pix', total: 25, entryDate: today(), paymentMethod: 'pix',
        });
        assert.equal(expense.status, 201);
        const saleEntry = await request('POST', '/cash-ledger/entries', {
          kind: 'sale', description: 'Moto API', total: 8000, personId: person.json.data.id,
          entryDate: '2026-10-05', paymentMethod: 'pix', downPayment: 2000,
          installmentCount: 6, firstDueDate: '2026-11-10', frequency: 'monthly',
        });
        assert.equal(saleEntry.status, 201);
        assert.equal(saleEntry.json.data.installments.length, 7);
        const received = await request('POST', `/cash-ledger/installments/${saleEntry.json.data.installments[1].installmentId}/receipts`, {
          amount: 400, receivedOn: today(), paymentMethod: 'pix',
        });
        assert.equal(received.status, 201);
        const detail = await request('GET', `/cash-ledger/entries/${saleEntry.json.data.entry.id}`);
        assert.equal(detail.json.data.installments[1].status, 'partial');
        const summary = await request('GET', `/cash-ledger/summary?month=${Number(today().slice(5, 7))}&year=${Number(today().slice(0, 4))}`);
        assert.equal(summary.status, 200);
        assert.equal(summary.json.data.spent, 25);
        assert.equal(summary.json.data.totalReceivable, 7600);
        const cashDashboard = await request('GET', `/cash-ledger/dashboard?period=all&month=${Number(today().slice(5, 7))}&year=${Number(today().slice(0, 4))}`);
        assert.equal(cashDashboard.status, 200);
        assert.equal(cashDashboard.json.data.totals.spentCents, 2500);
        assert.equal(cashDashboard.json.data.byPaymentMethod.find((item) => item.label === 'Pix').amountCents, 2500);
        assert.equal(cashDashboard.json.data.totals.totalReceivableCents, 760000);
        const dashboard = await request('GET', `/dashboard/summary?month=${Number(today().slice(5, 7))}&year=${Number(today().slice(0, 4))}`);
        assert.equal(dashboard.json.data.totals.cash.spent, 25);
        const budget = await request('GET', `/budgets?personId=${person.json.data.id}&year=${Number(today().slice(0, 4))}&month=${Number(today().slice(5, 7))}`);
        assert.equal(budget.json.data.monthly.cash.expense, 25);
        assert.equal(budget.json.data.monthly.cash.receipts, 400);
        const overview = await request('GET', `/dashboard/person-overview?personId=${person.json.data.id}&year=${Number(today().slice(0, 4))}`);
        assert.equal(overview.json.data.cashFlow.monthReceipts, 400);
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        db.close();
      }
    });
    assert.equal(loan.installments[0].dueDate, null);
    assert.equal(loan.installments[0].status, 'pending');
    assert.equal(service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4))).overdueCount, 0);

    const refund = service.create(userId, {
      kind: 'refund', description: 'Enel em duplicidade', total: 180, counterparty: 'Enel',
      entryDate: today(), paymentMethod: 'transfer', expectedReturnDate: offsetDate(5),
      refundStatus: 'requested', protocol: 'PROTO-123', notes: '',
    });
    assert.equal(refund.entry.refundStatus, 'requested');
    const beforeRefundPayment = service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4))).totalReceivable;
    service.setRefundStatus(userId, refund.entry.id, 'received');
    const afterRefundPayment = service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4))).totalReceivable;
    assert.equal(beforeRefundPayment - afterRefundPayment, 180);
    assert.equal(service.get(userId, refund.entry.id).entry.refundStatus, 'received');

    const lateEntry = service.create(userId, {
      kind: 'loan', description: 'Parcela vencida', total: 100, personId: secondPersonId,
      entryDate: today(), paymentMethod: 'cash', installmentCount: 1, loanTerm: 'date',
      firstDueDate: offsetDate(-1), interestRate: 0, frequency: 'monthly', notes: '',
    });
    assert.equal(lateEntry.installments[0].status, 'overdue');
    assert.equal(service.summary(userId, Number(today().slice(5, 7)), Number(today().slice(0, 4))).overdueCount, 1);

    const personDebts = service.personSummary(userId, personId);
    assert.equal(personDebts.total, 8500);
    assert.equal(personDebts.received, 2400);
    assert.equal(personDebts.outstanding, 6100);

    const bulkOne = service.create(userId, {
      kind: 'loan', description: 'Recebimento em lote A', total: 50, personId,
      entryDate: today(), paymentMethod: 'pix', installmentCount: 1, loanTerm: 'date',
      firstDueDate: offsetDate(1), interestRate: 0, frequency: 'monthly', notes: '',
    });
    const bulkTwo = service.create(userId, {
      kind: 'loan', description: 'Recebimento em lote B', total: 75, personId: secondPersonId,
      entryDate: today(), paymentMethod: 'cash', installmentCount: 1, loanTerm: 'date',
      firstDueDate: offsetDate(1), interestRate: 0, frequency: 'monthly', notes: '',
    });
    const bulkReceipts = service.receiveMany(userId, [bulkOne.installments[0].installmentId, bulkTwo.installments[0].installmentId], 'transfer', today());
    assert.equal(bulkReceipts.length, 2);
    assert.equal(service.get(userId, bulkOne.entry.id).installments[0].status, 'received');
    assert.equal(service.get(userId, bulkTwo.entry.id).installments[0].status, 'received');

    const partialReceiptId = detail.receipts.find((item) => item.installmentId === secondSaleInstallment.installmentId).id;
    service.undoReceipt(userId, partialReceiptId);
    detail = service.get(userId, motorcycle.entry.id);
    assert.equal(detail.installments.find((item) => item.installmentId === secondSaleInstallment.installmentId).status, 'pending');
    assert.equal(detail.installments.find((item) => item.installmentId === secondSaleInstallment.installmentId).outstanding, 1000);
  } finally {
    db.close();
  }
});

test('dashboard avulso agrega período, pagamentos, saldos, parcelas em atraso e listas', () => {
  const { db, service, userId, personId, secondPersonId, categoryId } = fixture();
  try {
    const current = today();
    const month = Number(current.slice(5, 7));
    const year = Number(current.slice(0, 4));
    const empty = service.dashboard(userId, { period: 'month', month, year });
    assert.equal(empty.totals.spentCents, 0);
    assert.equal(empty.totals.totalReceivableCents, 0);
    assert.equal(empty.byCategory.length, 0);
    assert.equal(empty.overdue.length, 0);
    assert.equal(empty.evolution.length, 12);
    service.create(userId, {
      kind: 'expense', description: 'Compra Pix', total: 25, entryDate: current,
      paymentMethod: 'pix', categoryId, notes: '',
    });
    const previousMonthDate = new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 10);
    service.create(userId, {
      kind: 'expense', description: 'Gasto anterior', total: 10, entryDate: previousMonthDate,
      paymentMethod: 'cash', categoryId, notes: '',
    });
    const saleEntry = service.create(userId, sale(personId, {
      entryDate: current, firstDueDate: offsetDate(10),
    }));
    service.receive(userId, saleEntry.installments[0].installmentId, {
      amount: 2000, receivedOn: current, paymentMethod: 'pix',
    });
    service.receive(userId, saleEntry.installments[1].installmentId, {
      amount: 400, receivedOn: current, paymentMethod: 'pix',
    });
    service.create(userId, {
      kind: 'refund', description: 'Enel paga em duplicidade', total: 180, counterparty: 'Enel',
      entryDate: current, expectedReturnDate: offsetDate(50), refundStatus: 'requested',
      protocol: 'ENEL-180', notes: '',
    });
    service.create(userId, {
      kind: 'loan', description: 'Parcela atrasada', total: 100, personId: secondPersonId,
      entryDate: current, paymentMethod: 'cash', installmentCount: 1, loanTerm: 'date',
      firstDueDate: offsetDate(-1), interestRate: 0, frequency: 'monthly', notes: '',
    });

    const dashboard = service.dashboard(userId, { period: 'month', month, year });
    assert.equal(dashboard.totals.spentCents, 2500);
    assert.equal(dashboard.totals.receivedCents, 240000);
    assert.equal(dashboard.totals.variationPercent, 150);
    assert.equal(dashboard.totals.totalReceivableCents, 588000);
    assert.equal(dashboard.totals.overdueCents, 10000);
    assert.equal(dashboard.totals.overdueCount, 1);
    assert.equal(dashboard.overdue[0].daysLate, 1);
    assert.equal(dashboard.upcoming[0].amountCents, 60000);
    const currentBucket = dashboard.evolution.find((item) => item.key === current.slice(0, 7));
    assert.equal(currentBucket.spentCents, 2500);
    assert.equal(currentBucket.receivedCents, 240000);
    assert.equal(dashboard.byPaymentMethod.find((item) => item.label === 'Pix').amountCents, 2500);
    assert.equal(dashboard.byCategory.find((item) => item.label === 'Alimentação').amountCents, 2500);
    const all = service.dashboard(userId, { period: 'all', month, year });
    assert.equal(all.byPerson.find((item) => item.id === personId).outstandingCents, 560000);
    assert.equal(dashboard.refunds[0].protocol, 'ENEL-180');
    assert.equal(dashboard.movements.some((item) => item.description === 'Compra Pix'), true);
    assert.equal(service.get(userId, saleEntry.entry.id).installments[1].outstanding, 600);
    const lastThree = service.dashboard(userId, { period: 'last3', month, year });
    assert.equal(lastThree.totals.spentCents, 3500);
    assert.equal(all.totals.spentCents, 3500);
    assert.equal(all.totals.totalReceivableCents, 588000);
    assert.equal(all.totals.overdueCents, dashboard.totals.overdueCents);
  } finally {
    db.close();
  }
});

test('edição recalcula parcelas não quitadas e não reduz o valor abaixo dos recebimentos', () => {
  const { db, service, userId, personId } = fixture();
  try {
    const entry = service.create(userId, {
      kind: 'loan', description: 'Parcelado', total: 100, personId, entryDate: today(),
      paymentMethod: 'pix', installmentCount: 2, loanTerm: 'installments',
      firstDueDate: offsetDate(2), interestRate: 0, frequency: 'monthly', notes: '',
    });

    test('empréstimo calcula juros simples mensais sem ponto flutuante', () => {
      const { db, service, userId, personId } = fixture();
      try {
        const loan = service.create(userId, {
          kind: 'loan', description: 'Juros de seis meses', total: 500, personId, entryDate: '2026-10-21',
          paymentMethod: 'pix', installmentCount: 6, loanTerm: 'installments',
          firstDueDate: '2026-11-21', interestRate: 1, frequency: 'monthly', notes: '',
        });
        assert.equal(loan.installments.reduce((sum, item) => sum + item.amountCents, 0), 53000);
      } finally {
        db.close();
      }
    });
    const first = entry.installments[0];
    service.receive(userId, first.installmentId, { amount: 20, receivedOn: today(), paymentMethod: 'pix' });
    const updated = service.update(userId, entry.entry.id, {
      kind: 'loan', description: 'Parcelado atualizado', total: 120, personId, entryDate: today(),
      paymentMethod: 'pix', installmentCount: 2, loanTerm: 'installments',
      firstDueDate: offsetDate(2), interestRate: 0, frequency: 'monthly', notes: '',
    });
    const retained = updated.installments.find((item) => item.installmentId === first.installmentId);
    assert.equal(retained.received, 20);
    assert.equal(retained.amount, 60);
    assert.throws(() => service.update(userId, entry.entry.id, {
      kind: 'loan', description: 'Valor inválido', total: 15, personId, entryDate: today(),
      paymentMethod: 'pix', installmentCount: 2, loanTerm: 'installments',
      firstDueDate: offsetDate(2), interestRate: 0, frequency: 'monthly', notes: '',
    }), /menor que o total já recebido/);
  } finally {
    db.close();
  }
});
