import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Person } from '../src/models/Person.js';
import { CashEntry } from '../src/models/CashEntry.js';
import { getInvoiceDuePeriod } from '../src/lib/cardBilling.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-vehicles';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { createApp } = await import('../src/app.js');

let server, base, stopMongo;
before(async () => {
  stopMongo = await startMongoMemory();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(clearMongoMemory);
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (stopMongo) await stopMongo();
});

async function setup(email) {
  const account = await createTestAccount({ email, name: 'Test' });
  const people = await Person.create(
    ['Pessoa 01', 'Pessoa 02', 'Pessoa 03'].map((name) => ({ userId: account.user._id, name })),
  );
  const ids = {};
  for (const person of people) ids[person.name] = String(person._id);
  return { c: createApiClient(base, account.cookie), cookie: account.cookie, ids };
}
const car = { kind: 'car', model: 'Carro de demonstração', plate: 'demo-001', year: 2024, purchaseValue: 50000, status: 'active' };

test('cadastra veículos, normaliza a placa e bloqueia placa repetida', async () => {
  const { c, ids } = await setup('v1@teste.com');
  await c('PUT', `/people/${ids['Pessoa 01']}`, { name: 'Pessoa 01', avatar: 'data:image/jpeg;base64,aGVsbG8=' });
  const v = await c('POST', '/vehicles', { ...car, ownerId: ids['Pessoa 01'] });
  assert.equal(v.status, 201, v.text);
  assert.equal(v.json.data.plate, 'DEMO001');
  assert.equal(v.json.data.totalSpent, 0);
  assert.equal(v.json.data.ownerId, ids['Pessoa 01']);
  assert.equal(v.json.data.ownerName, 'Pessoa 01');
  assert.equal(v.json.data.ownerAvatar, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal((await c('POST', '/vehicles', { ...car, plate: 'DEMO 001' })).status, 409);
  assert.equal((await c('POST', '/vehicles', { ...car, plate: '!!' })).status, 400);
  assert.equal((await c('POST', '/vehicles', { ...car, plate: 'DEMO003', ownerId: 99999 })).status, 400);
  const moto = await c('POST', '/vehicles', { kind: 'motorcycle', model: 'Motocicleta de demonstração', plate: 'DEMO002', year: 2024, purchaseValue: 12000 });
  assert.equal(moto.status, 201);
  const list = (await c('GET', '/vehicles')).json.data;
  assert.deepEqual(list.map((x) => x.model).sort(), ['Carro de demonstração', 'Motocicleta de demonstração']);
  assert.equal(list.find((x) => x.model === car.model).ownerName, 'Pessoa 01');
  const up = await c('PUT', `/vehicles/${v.json.data.id}`, { ...car, plate: 'DEMO001', ownerId: null, status: 'sold' });
  assert.equal(up.json.data.status, 'sold');
  assert.equal(up.json.data.ownerId, null);
});

test('gasto individual: valor mínimo R$ 1, categoria válida, km e fatia do pagador', async () => {
  const { c, ids } = await setup('v2@teste.com');
  const v = (await c('POST', '/vehicles', car)).json.data;
  const base = { vehicleId: v.id, date: '2026-03-10', category: 'fuel', description: 'Combustível', amount: 250.5, km: 12000, payerId: ids['Pessoa 01'] };
  const ok = await c('POST', '/vehicles/expenses', base);
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.data.shared, false);
  assert.equal((await c('GET', '/purchases')).json.total, 0);
  assert.deepEqual(ok.json.data.shares.map((s) => [s.person, s.amount]), [['Pessoa 01', 250.5]]);
  assert.equal(ok.json.data.group, 'operational');
  assert.equal((await c('POST', '/vehicles/expenses', { ...base, amount: 1 })).status, 201); // limite: R$ 1,00 vale
  assert.equal((await c('POST', '/vehicles/expenses', { ...base, amount: 0.99 })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...base, category: 'xyz' })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...base, date: '2026-02-31' })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...base, payerId: 99999 })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...base, vehicleId: 99999 })).status, 400);
  const got = (await c('GET', `/vehicles/${v.id}`)).json.data;
  assert.equal(got.totalSpent, 251.5);
  assert.equal(got.expensesCount, 2);
  assert.equal(got.currentKm, 12000);
});

test('despesas de veículo em dinheiro permanecem sincronizadas e aparecem em Veículos na planilha', async () => {
  const { c, ids } = await setup('vehicle-cash-ledger@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const body = {
    vehicleId: vehicle.id, date: '2026-03-10', category: 'fuel', description: 'Abastecimento',
    amount: 125.5, payerId: ids['Pessoa 01'],
  };
  const created = await c('POST', '/vehicles/expenses', body);
  assert.equal(created.status, 201, created.text);
  const expenseId = created.json.data.id;

  const list = await c('GET', '/cash-ledger/entries?all=true');
  const mirrored = list.json.data.find((item) => item.vehicleExpenseId === expenseId);
  assert.ok(mirrored);
  assert.equal(mirrored.kind, 'expense');
  assert.equal(mirrored.amount, 125.5);
  assert.equal(mirrored.paymentMethod, 'cash');
  assert.equal(mirrored.personId, ids['Pessoa 01']);
  assert.equal(mirrored.vehicleName, car.model);
  assert.equal((await c('GET', '/cash-ledger/summary?month=3&year=2026')).json.data.spent, 125.5);
  const dashboardSummary = await c('GET', `/dashboard/summary?month=3&year=2026&personId=${ids['Pessoa 01']}`);
  assert.equal(dashboardSummary.json.data.totals.cash.spent, 125.5);
  const cashDashboard = await c('GET', '/cash-ledger/dashboard?period=month&month=3&year=2026');
  assert.equal(cashDashboard.json.data.totals.spentCents, 12550);
  assert.equal(cashDashboard.json.data.byCategory.find((item) => item.label === 'Vale combustível').amountCents, 12550);
  const budget = await c('GET', `/budgets?personId=${ids['Pessoa 01']}&year=2026&month=3`);
  assert.equal(budget.json.data.monthly.cash.expense, 0);
  const vehicleRow = budget.json.data.sections.find((section) => section.key === 'vehicle').rows.find((row) => row.computed);
  assert.equal(vehicleRow.values[2], 125.5);
  const overview = await c('GET', `/dashboard/person-overview?personId=${ids['Pessoa 01']}&year=2026`);
  assert.equal(overview.json.data.vehicleExpenses.find((row) => row.id === `vehicle-expense-${expenseId}`).values[2], 125.5);
  assert.equal(overview.json.data.cashFlow.expenses[2], 0);
  assert.equal(overview.json.data.totals[2], 125.5);
  const person = await Person.findById(ids['Pessoa 01']).select('shareToken').lean();
  const portal = await c('GET', `/portal/${person.shareToken}`);
  const portalMonth = portal.json.data.months.find((month) => month.year === 2026 && month.month === 3);
  assert.equal(portalMonth.fixedExpenses.find((item) => item.description.includes('Abastecimento')).amount, 125.5);
  assert.equal(portalMonth.total, 125.5);
  const fixedRow = await c('POST', `/budgets/${budget.json.data.sheetId}/rows`, { section: 'fixed', label: 'Conta fixa de teste' });
  assert.equal(fixedRow.status, 201, fixedRow.text);
  assert.equal((await c('PUT', `/budgets/rows/${fixedRow.json.data.id}/cells/3`, { value: 150 })).status, 200);
  const billing = await c('GET', `/reminders/billing/${ids['Pessoa 01']}?month=3&year=2026`);
  assert.equal(billing.json.grandTotal, 125.5);
  assert.equal(billing.json.totalFixedExpenses, 125.5);
  assert.equal(billing.json.grandTotalPending, 125.5);
  assert.ok(billing.json.formattedMessage.includes('Abastecimento'));
  assert.ok(!billing.json.formattedMessage.includes('Conta fixa de teste'));

  const rejectedDelete = await c('DELETE', `/cash-ledger/entries/${mirrored.id}`);
  assert.equal(rejectedDelete.status, 409);

  await CashEntry.deleteOne({ userId: (await Person.findById(ids['Pessoa 01'])).userId, vehicleExpenseId: expenseId });
  const backfilled = await c('GET', '/cash-ledger/entries?all=true');
  assert.equal(backfilled.json.data.filter((item) => item.vehicleExpenseId === expenseId).length, 1);

  const updated = await c('PUT', `/vehicles/expenses/${expenseId}`, { ...body, amount: 200, description: 'Abastecimento atualizado' });
  assert.equal(updated.status, 200, updated.text);
  const afterUpdate = await c('GET', '/cash-ledger/entries?all=true');
  const updatedMirror = afterUpdate.json.data.find((item) => item.vehicleExpenseId === expenseId);
  assert.equal(updatedMirror.amount, 200);
  assert.match(updatedMirror.description, /Abastecimento atualizado/);
  assert.equal(await CashEntry.countDocuments({ vehicleExpenseId: expenseId }), 1);

  assert.equal((await c('DELETE', `/vehicles/expenses/${expenseId}`)).status, 204);
  assert.equal((await c('GET', '/cash-ledger/entries?all=true')).json.data.some((item) => item.vehicleExpenseId === expenseId), false);
});

test('despesa em dinheiro compartilhada repete a parte de cada pessoa na planilha', async () => {
  const { c, ids } = await setup('vehicle-budget-recurrence@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const financed = await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date: '2026-03-10', category: 'financing', description: 'Financiamento',
    amount: 120, payerId: ids['Pessoa 01'], shared: true,
    participantIds: [ids['Pessoa 01'], ids['Pessoa 02'], ids['Pessoa 03']],
    recurrenceType: 'installments', recurrenceCount: 48,
  });
  assert.equal(financed.status, 201, financed.text);
  assert.equal(financed.json.data.recurrenceType, 'installments');
  assert.equal(financed.json.data.recurrenceCount, 48);

  const annualTax = await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date: '2026-05-04', category: 'ipva', description: 'IPVA',
    amount: 300, payerId: ids['Pessoa 01'], shared: true,
    participantIds: [ids['Pessoa 01'], ids['Pessoa 02'], ids['Pessoa 03']],
  });
  assert.equal(annualTax.status, 201, annualTax.text);

  const ongoing = await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date: '2026-12-03', category: 'licensing', description: 'Licenciamento mensal',
    amount: 90, payerId: ids['Pessoa 02'], recurrenceType: 'ongoing',
  });
  assert.equal(ongoing.status, 201, ongoing.text);

  const getSheet = async (personId, year, month) => (await c('GET', `/budgets?personId=${personId}&year=${year}&month=${month}`)).json.data;
  const sectionFor = (sheet) => sheet.sections.find((section) => section.key === 'vehicle');
  const financedRow = (section) => section.rows.find((row) => row.id === `vehicle-expense-${financed.json.data.id}`);
  const taxRow = (section) => section.rows.find((row) => row.id === `vehicle-expense-${annualTax.json.data.id}`);
  const ongoingRow = (section) => section.rows.find((row) => row.id === `vehicle-expense-${ongoing.json.data.id}`);

  for (const personId of [ids['Pessoa 01'], ids['Pessoa 02'], ids['Pessoa 03']]) {
    const sheet = await getSheet(personId, 2026, 3);
    const section = sectionFor(sheet);
    const monthlyExpense = sheet.summary.lines.find((line) => line.key === 'spent').values[2];
    assert.equal(financedRow(section).values[2], 40);
    assert.equal(financedRow(section).values[11], 40);
    assert.equal(financedRow(section).total, 400);
    assert.equal(monthlyExpense, 40);
    assert.equal(sheet.monthly.cash.expense, 0);
  }

  const nextYear = sectionFor(await getSheet(ids['Pessoa 02'], 2027, 1));
  assert.equal(financedRow(nextYear).values[0], 40);
  assert.equal(financedRow(nextYear).total, 480);
  assert.equal(ongoingRow(nextYear).values[0], 90);

  const currentYear = sectionFor(await getSheet(ids['Pessoa 03'], 2026, 5));
  assert.equal(taxRow(currentYear).values[4], 100);
  assert.equal(taxRow(currentYear).values[3], 0);

  const lastFinancedYear = sectionFor(await getSheet(ids['Pessoa 01'], 2030, 3));
  assert.equal(financedRow(lastFinancedYear).values[0], 40);
  assert.equal(financedRow(lastFinancedYear).values[1], 40);
  assert.equal(financedRow(lastFinancedYear).values[2], 0);
  for (const personId of [ids['Pessoa 01'], ids['Pessoa 02'], ids['Pessoa 03']]) {
    const person = await Person.findById(personId).select('shareToken').lean();
    const portal = await c('GET', `/portal/${person.shareToken}`);
    const portalMonth = portal.json.data.months.find((month) => month.year === 2026 && month.month === 3);
    assert.equal(portalMonth.fixedExpenses.find((item) => item.description.includes('Financiamento')).amount, 40);
    const futurePortalMonth = portal.json.data.months.find((month) => month.year === 2027 && month.month === 3);
    assert.equal(futurePortalMonth.fixedExpenses.find((item) => item.description.includes('Financiamento')).amount, 40);
    const billing = await c('GET', `/reminders/billing/${personId}?month=3&year=2026`);
    assert.equal(billing.json.grandTotal, 40);
    const overview = await c('GET', `/dashboard/person-overview?personId=${personId}&year=2026`);
    assert.equal(overview.json.data.vehicleExpenses.find((row) => row.id === `vehicle-expense-${financed.json.data.id}`).values[2], 40);
    assert.equal(overview.json.data.totals[2], 40);
  }
  assert.equal((await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date: '2026-03-10', category: 'financing', amount: 120,
    payerId: ids['Pessoa 01'], recurrenceType: 'installments',
  })).status, 400);
});

test('KM atual avança sem reduzir e litros são aceitos somente em combustível', async () => {
  const { c, ids } = await setup('vehicle-mileage@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const expense = {
    vehicleId: vehicle.id, date: '2026-03-10', category: 'fuel', description: 'Abastecimento',
    amount: 250, km: 41200, liters: 42.5, payerId: ids['Pessoa 01'],
  };
  const first = await c('POST', '/vehicles/expenses', expense);
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.data.liters, 42.5);
  assert.equal((await c('GET', `/vehicles/${vehicle.id}`)).json.data.currentKm, 41200);

  const lower = await c('POST', '/vehicles/expenses', { ...expense, km: 41000, liters: undefined });
  assert.equal(lower.status, 201, lower.text);
  assert.equal((await c('GET', `/vehicles/${vehicle.id}`)).json.data.currentKm, 41200);
  assert.equal((await c('POST', '/vehicles/expenses', { ...expense, category: 'oil', liters: 2 })).status, 400);

  const updated = await c('PUT', `/vehicles/${vehicle.id}`, { ...car, plate: vehicle.plate, currentKm: 39000 });
  assert.equal(updated.json.data.currentKm, 39000);
  const afterManualEdit = await c('POST', '/vehicles/expenses', { ...expense, km: 38000, liters: undefined });
  assert.equal(afterManualEdit.status, 201, afterManualEdit.text);
  assert.equal((await c('GET', `/vehicles/${vehicle.id}`)).json.data.currentKm, 39000);
  assert.equal((await c('DELETE', `/vehicles/expenses/${first.json.data.id}`)).status, 204);
  assert.equal((await c('GET', `/vehicles/${vehicle.id}`)).json.data.currentKm, 39000);
});

test('rateio: iguais fecham no centavo, por % e por R$; erros de soma', async () => {
  const { c, ids } = await setup('v3@teste.com');
  const v = (await c('POST', '/vehicles', car)).json.data;
  const sh = { vehicleId: v.id, date: '2026-04-01', category: 'insurance', description: 'Seguro anual', amount: 100, payerId: ids['Pessoa 01'], shared: true };
  const eq = (await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'equal', participantIds: [ids['Pessoa 01'], ids['Pessoa 02'], ids['Pessoa 03']] })).json.data;
  const total = (s) => Math.round(s.reduce((a, x) => a + x.amount * 100, 0));
  assert.equal(total(eq.shares), 10000);
  assert.deepEqual(eq.shares.map((s) => s.amount).sort(), [33.33, 33.33, 33.34]);

  const pct = await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'percent', participants: [{ personId: ids['Pessoa 01'], value: 50 }, { personId: ids['Pessoa 02'], value: 30 }, { personId: ids['Pessoa 03'], value: 20 }] });
  assert.deepEqual(pct.json.data.shares.map((s) => [s.person, s.amount]), [['Pessoa 01', 50], ['Pessoa 02', 30], ['Pessoa 03', 20]]);

  const amt = await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'amount', participants: [{ personId: ids['Pessoa 01'], value: 70 }, { personId: ids['Pessoa 02'], value: 30 }] });
  assert.equal(amt.status, 201, amt.text);

  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'percent', participants: [{ personId: ids['Pessoa 01'], value: 50 }, { personId: ids['Pessoa 02'], value: 30 }] })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'amount', participants: [{ personId: ids['Pessoa 01'], value: 70 }, { personId: ids['Pessoa 02'], value: 20 }] })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, participantIds: [ids['Pessoa 01']] })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, participantIds: [ids['Pessoa 01'], ids['Pessoa 01']] })).status, 400);

  // editar troca o rateio por completo; virar individual deixa só o pagador
  const id = eq.id;
  const ed = await c('PUT', `/vehicles/expenses/${id}`, { ...sh, shared: false });
  assert.deepEqual(ed.json.data.shares.map((s) => [s.person, s.amount]), [['Pessoa 01', 100]]);
});

test('painel: totais, categorias, meses e saldo de quem pagou × quem deve', async () => {
  const { c, ids } = await setup('v4@teste.com');
  const a = (await c('POST', '/vehicles', car)).json.data;
  const b = (await c('POST', '/vehicles', { ...car, kind: 'motorcycle', model: 'Motocicleta demonstrativa', plate: 'DEMO002' })).json.data;
  const mk = (o) => c('POST', '/vehicles/expenses', { date: '2026-01-15', description: '', ...o });
  await mk({ vehicleId: a.id, category: 'ipva', amount: 900, payerId: ids['Pessoa 01'] }); // individual
  await mk({ vehicleId: a.id, category: 'fuel', amount: 200, payerId: ids['Pessoa 01'], shared: true, participantIds: [ids['Pessoa 01'], ids['Pessoa 02']], km: 1000 });
  await mk({ vehicleId: b.id, category: 'oil', amount: 100, payerId: ids['Pessoa 02'], date: '2025-12-02', km: 500 });
  await mk({ vehicleId: a.id, category: 'tires', amount: 400, payerId: ids['Pessoa 03'], km: 3000 });

  const fleet = (await c('GET', '/vehicles/summary?year=2026')).json.data;
  assert.equal(fleet.total, 1500);
  assert.equal(fleet.byMonth.length, 12);
  assert.equal(fleet.byMonth[0].total, 1500);
  assert.deepEqual(fleet.byGroup.map((g) => [g.key, g.total]), [['fixed', 900], ['maintenance', 400], ['operational', 200]]);
  const pessoa = (n) => fleet.people.find((p) => p.name === n);
  assert.deepEqual([pessoa('Pessoa 01').paid, pessoa('Pessoa 01').owes, pessoa('Pessoa 01').balance], [1100, 1000, 100]);
  assert.deepEqual([pessoa('Pessoa 02').paid, pessoa('Pessoa 02').owes, pessoa('Pessoa 02').balance], [0, 100, -100]);
  assert.equal(pessoa('Pessoa 03').balance, 0);

  const one = (await c('GET', `/vehicles/summary?vehicleId=${a.id}`)).json.data;
  assert.equal(one.total, 1500);
  assert.equal(one.currentKm, 3000);
  assert.equal(one.kmSpan, 2000);
  assert.equal(one.costPerKm, 0.75);
  const all = (await c('GET', '/vehicles/summary')).json.data;
  assert.equal(all.total, 1600);
  assert.equal(all.byVehicle.length, 2);

  // filtros da lista
  const q = async (s) => (await c('GET', `/vehicles/expenses?${s}`)).json;
  assert.equal((await q(`vehicleId=${b.id}`)).total, 1);
  assert.equal((await q('group=fixed')).sum, 900);
  assert.equal((await q('shared=true')).total, 1);
  assert.equal((await q(`personId=${ids['Pessoa 02']}`)).total, 2); // pagou o óleo + divide o combustível
  assert.equal((await q('year=2025')).total, 1);
  assert.equal((await q('from=2026-01-01&to=2026-01-31')).total, 3);
  const csv = (await c('GET', '/vehicles/expenses/export.csv')).text;
  assert.equal(csv.split('\n').length, 5);
});

test('resumo do veículo inclui gastos recentes com suas datas em ordem decrescente', async () => {
  const { c, ids } = await setup('v-recent-expenses@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const addExpense = (date, description) => c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date, category: 'oil', description, amount: 150, payerId: ids['Pessoa 01'],
  });
  await addExpense('2026-05-02', 'Troca de óleo');
  await addExpense('2026-07-14', 'Revisão');

  const summary = (await c('GET', `/vehicles/summary?vehicleId=${vehicle.id}&year=2026`)).json.data;
  assert.deepEqual(summary.recentExpenses.map(({ date, categoryLabel, description }) => [date, categoryLabel, description]), [
    ['2026-07-14', 'Troca de óleo', 'Revisão'],
    ['2026-05-02', 'Troca de óleo', 'Troca de óleo'],
  ]);
});

test('resumo por período calcula comparação, média, custo por km e consumo', async () => {
  const { c, ids } = await setup('vehicle-summary-period@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const add = (date, category, amount, km, liters) => c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date, category, amount, km, liters, payerId: ids['Pessoa 01'],
  });
  await add('2026-03-01', 'fuel', 100, 1000, 40);
  await add('2026-03-10', 'fuel', 100, 1400, 40);
  await add('2026-02-20', 'oil', 50, 900);
  await add('2025-03-01', 'fuel', 75, 500, 35);

  const summary = (await c('GET', `/vehicles/summary?vehicleId=${vehicle.id}&year=2026&period=month&month=3`)).json.data;
  assert.equal(summary.total, 200);
  assert.equal(summary.comparison.total, 50);
  assert.equal(summary.comparison.percentChange, 300);
  assert.equal(summary.averageMonthly, 200);
  assert.equal(summary.costPerKm, 0.5);
  assert.equal(summary.consumptionKmPerLiter, 10);
  assert.equal(summary.byMonth.length, 12);
  assert.equal(summary.byMonth[2].total, 200);
  assert.equal(summary.recentExpenses.length, 2);

  const quarter = (await c('GET', `/vehicles/summary?vehicleId=${vehicle.id}&year=2026&period=quarter&month=3`)).json.data;
  assert.equal(quarter.total, 250);
});

test('lembretes calculam status, notificam uma vez por mudança e completam com gasto', async () => {
  const { c, ids } = await setup('vehicle-reminders@teste.com');
  const other = await setup('vehicle-reminders-other@teste.com');
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const vehicle = (await c('POST', '/vehicles', { ...car, currentKm: 100000 })).json.data;
  const oil = await c('POST', '/vehicles/maintenance', {
    vehicleId: vehicle.id, type: 'oil', rule: 'km', intervalKm: 1000,
    lastPerformedDate: '2025-01-01', lastPerformedKm: 99000,
  });
  assert.equal(oil.status, 201, oil.text);
  assert.equal(oil.json.data.status, 'upcoming', JSON.stringify(oil.json.data));
  const fixed = await c('POST', '/vehicles/maintenance', {
    vehicleId: vehicle.id, type: 'insurance', rule: 'fixed_date', dueDate: '2020-01-01',
  });
  assert.equal(fixed.status, 201, fixed.text);
  assert.equal(fixed.json.data.status, 'overdue');
  assert.equal((await other.c('GET', '/vehicles/maintenance')).json.data.length, 0);

  const alerts = await c('GET', '/reminders/alerts');
  assert.equal(alerts.json.alerts.filter((alert) => alert.type === 'vehicle_reminder').length, 2);
  const repeatedAlerts = await c('GET', '/reminders/alerts');
  assert.equal(repeatedAlerts.json.alerts.filter((alert) => alert.type === 'vehicle_reminder').length, 0);

  const savedExpense = await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date: todayIso, category: 'oil', description: 'Troca de óleo',
    amount: 250, km: 100001, payerId: ids['Pessoa 01'], reminderId: oil.json.data.id,
  });
  assert.equal(savedExpense.status, 201, savedExpense.text);
  const updated = (await c('GET', `/vehicles/maintenance?vehicleId=${vehicle.id}`)).json.data
    .find((reminder) => reminder.id === oil.json.data.id);
  assert.equal(updated.lastPerformedDate, todayIso);
  assert.equal(updated.lastPerformedKm, 100001);
  assert.equal(updated.status, 'on_track');

  const paid = await c('POST', `/vehicles/maintenance/${fixed.json.data.id}/paid`);
  assert.equal(paid.json.data.status, 'paid');
  assert.equal(paid.json.data.active, false);
  await c('GET', '/reminders/alerts');
  await c('PUT', `/vehicles/${vehicle.id}`, { ...car, plate: vehicle.plate, currentKm: 101002 });
  const changedStatusAlerts = await c('GET', '/reminders/alerts');
  assert.equal(changedStatusAlerts.json.alerts.filter((alert) => alert.type === 'vehicle_reminder').length, 1);
  assert.equal(changedStatusAlerts.json.alerts.find((alert) => alert.type === 'vehicle_reminder').status, 'overdue');
  const repeatedOverdueAlerts = await c('GET', '/reminders/alerts');
  assert.equal(repeatedOverdueAlerts.json.alerts.filter((alert) => alert.type === 'vehicle_reminder').length, 0);

  const future = new Date();
  future.setDate(future.getDate() + 40);
  const near = await c('POST', '/vehicles/maintenance', {
    vehicleId: vehicle.id, type: 'licensing', rule: 'fixed_date',
    dueDate: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
  });
  assert.equal(near.json.data.status, 'on_track');
  const settings = await c('PUT', '/vehicles/maintenance/settings', { daysBefore: 45, kmBefore: 800 });
  assert.deepEqual(settings.json.data, { daysBefore: 45, kmBefore: 800 });
  const otherSettings = await other.c('GET', '/vehicles/maintenance/settings');
  assert.deepEqual(otherSettings.json.data, { daysBefore: 30, kmBefore: 500 });
  const adjusted = (await c('GET', `/vehicles/maintenance?vehicleId=${vehicle.id}`)).json.data
    .find((reminder) => reminder.id === near.json.data.id);
  assert.equal(adjusted.status, 'upcoming');
});

test('documentos são privados e criam/removem lembretes de validade', async () => {
  const { c, cookie } = await setup('vehicle-documents@teste.com');
  const other = await setup('vehicle-documents-other@teste.com');
  const dateAfter = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const vehicle = (await c('POST', '/vehicles', {
    ...car, insuranceDueDate: dateAfter(40),
  })).json.data;
  const form = new FormData();
  form.append('vehicleId', vehicle.id);
  form.append('name', 'CRLV digital');
  form.append('type', 'crlv');
  form.append('dueDate', dateAfter(20));
  form.append('file', new Blob(['%PDF-1.4\nvehicle document'], { type: 'application/pdf' }), 'crlv.pdf');
  const uploaded = await fetch(`${base}/vehicles/documents`, {
    method: 'POST', headers: { Cookie: cookie }, body: form,
  });
  const document = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(document));
  assert.equal(document.data.contentType, 'application/pdf');

  const reminders = (await c('GET', `/vehicles/maintenance?vehicleId=${vehicle.id}`)).json.data;
  assert.equal(reminders.some((item) => item.source === 'insurance' && item.dueDate === dateAfter(40)), true);
  assert.equal(reminders.some((item) => item.source === 'document' && item.title === 'Validade: CRLV digital'), true);

  const appUrl = base.slice(0, -4);
  const view = await fetch(`${appUrl}${document.data.fileUrl}`, { headers: { Cookie: cookie } });
  assert.equal(view.status, 200);
  assert.match(view.headers.get('content-type'), /application\/pdf/);
  const download = await fetch(`${appUrl}${document.data.downloadUrl}`, { headers: { Cookie: cookie } });
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  const denied = await fetch(`${appUrl}${document.data.fileUrl}`, { headers: { Cookie: other.cookie } });
  assert.equal(denied.status, 404);

  await c('DELETE', `/vehicles/documents/${document.data.id}`);
  const afterDelete = (await c('GET', `/vehicles/maintenance?vehicleId=${vehicle.id}`)).json.data;
  assert.equal(afterDelete.some((item) => item.source === 'document'), false);
  const clearInsurance = await c('PUT', `/vehicles/${vehicle.id}`, { ...car, insuranceDueDate: null });
  assert.equal(clearInsurance.status, 200, clearInsurance.text);
  const afterInsuranceClear = (await c('GET', `/vehicles/maintenance?vehicleId=${vehicle.id}`)).json.data;
  assert.equal(afterInsuranceClear.some((item) => item.source === 'insurance'), false);

  const resetForm = new FormData();
  resetForm.append('vehicleId', vehicle.id);
  resetForm.append('name', 'Comprovante');
  resetForm.append('type', 'other');
  resetForm.append('file', new Blob(['%PDF-1.4\nreset test'], { type: 'application/pdf' }), 'comprovante.pdf');
  const resetDocument = await fetch(`${base}/vehicles/documents`, {
    method: 'POST', headers: { Cookie: cookie }, body: resetForm,
  });
  const resetDocumentData = await resetDocument.json();
  assert.equal(resetDocument.status, 201, JSON.stringify(resetDocumentData));
  assert.equal((await c('POST', '/system/reset-all')).status, 200);
  assert.equal((await c('GET', '/vehicles')).json.data.length, 0);
  assert.equal((await c('GET', '/vehicles/documents')).json.data.length, 0);
  assert.equal((await fetch(`${appUrl}${resetDocumentData.data.fileUrl}`, { headers: { Cookie: cookie } })).status, 404);
});

test('excluir: veículo com histórico exige force; pessoa com gasto não pode ser apagada', async () => {
  const { c, ids } = await setup('v5@teste.com');
  const v = (await c('POST', '/vehicles', car)).json.data;
  const e = (await c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-05-05', category: 'wash', amount: 30, payerId: ids['Pessoa 03'] })).json.data;
  assert.equal((await c('DELETE', `/people/${ids['Pessoa 03']}`)).status, 409);
  assert.equal((await c('DELETE', `/vehicles/${v.id}`)).status, 409);
  assert.equal((await c('DELETE', `/vehicles/expenses/${e.id}`)).status, 204);
  assert.equal((await c('DELETE', `/people/${ids['Pessoa 03']}`)).status, 204);
  await c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-05-05', category: 'wash', amount: 30, payerId: ids['Pessoa 01'] });
  assert.equal((await c('DELETE', `/vehicles/${v.id}?force=true`)).status, 204);
  assert.equal((await c('GET', '/vehicles/expenses')).json.total, 0); // histórico foi junto
});

test('isolamento: outro usuário não vê nem mexe nos veículos e gastos', async () => {
  const a = await setup('iso-a@teste.com');
  const b = await setup('iso-b@teste.com');
  const v = (await a.c('POST', '/vehicles', car)).json.data;
  const e = (await a.c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-06-06', category: 'fuel', amount: 80, payerId: a.ids['Pessoa 01'] })).json.data;
  assert.equal((await b.c('GET', '/vehicles')).json.data.length, 0);
  assert.equal((await b.c('GET', `/vehicles/${v.id}`)).status, 404);
  assert.equal((await b.c('GET', `/vehicles/expenses/${e.id}`)).status, 404);
  assert.equal((await b.c('PUT', `/vehicles/expenses/${e.id}`, { vehicleId: v.id, date: '2026-06-06', category: 'fuel', amount: 1, payerId: b.ids['Pessoa 01'] })).status, 404);
  assert.equal((await b.c('DELETE', `/vehicles/expenses/${e.id}`)).status, 404);
  assert.equal((await b.c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-06-06', category: 'fuel', amount: 5, payerId: b.ids['Pessoa 01'] })).status, 400);
  assert.equal((await b.c('POST', '/vehicles/expenses', { vehicleId: (await b.c('POST', '/vehicles', car)).json.data.id, date: '2026-06-06', category: 'fuel', amount: 5, payerId: a.ids['Pessoa 01'] })).status, 400);
  assert.equal((await b.c('GET', `/vehicles/summary?vehicleId=${v.id}`)).status, 404);
  assert.equal((await b.c('GET', '/vehicles/summary')).json.data.total, 0);
  assert.equal((await a.c('GET', '/vehicles')).json.data[0].totalSpent, 80);
});

test('exige login', async () => {
  const c = createApiClient(base);
  assert.equal((await c('GET', '/vehicles')).status, 401);
  assert.equal((await c('GET', '/vehicles/expenses')).status, 401);
});

test('foto do veículo é privada, pode ser substituída e removida', async () => {
  const { c, cookie } = await setup('vehicle-photo@teste.com');
  const other = await setup('vehicle-photo-other@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=', 'base64');
  const upload = async () => {
    const form = new FormData();
    form.append('photo', new Blob([image], { type: 'image/png' }), 'photo.png');
    form.append('thumbnail', new Blob([image], { type: 'image/png' }), 'thumb.png');
    return fetch(`${base}/vehicles/${vehicle.id}/photo`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  };
  const first = await upload();
  assert.equal(first.status, 200);
  const firstVehicle = (await first.json()).data;
  assert.equal(firstVehicle.photoUrl, `/api/vehicles/${vehicle.id}/photo`);
  assert.equal(firstVehicle.photoThumbnailUrl, `/api/vehicles/${vehicle.id}/photo/thumbnail`);
  assert.equal((await fetch(`${base}/vehicles/${vehicle.id}/photo`, { headers: { Cookie: other.cookie } })).status, 404);
  const photo = await fetch(`${base}/vehicles/${vehicle.id}/photo`, { headers: { Cookie: cookie } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  const second = await upload();
  assert.equal(second.status, 200);
  assert.equal((await c('DELETE', `/vehicles/${vehicle.id}/photo`)).status, 204);
  assert.equal((await c('GET', `/vehicles/${vehicle.id}`)).json.data.photoUrl, null);
  assert.equal((await fetch(`${base}/vehicles/${vehicle.id}/photo`, { headers: { Cookie: cookie } })).status, 404);
});

test('gasto no cartão cria compra vinculada, parcelas e atualiza limite sem duplicar', async () => {
  const { c, ids } = await setup('v6@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const card = (await c('POST', '/cards', { name: 'Cartão de demonstração', limit: 2000, ownerId: ids['Pessoa 01'], closingDay: 22, dueDay: 5 })).json.data;
  const expenseBody = {
    vehicleId: vehicle.id, date: '2026-10-20', category: 'fuel', description: 'Abastecimento',
    amount: 100.01, payerId: ids['Pessoa 01'], paymentMethod: 'card', cardId: card.id, installmentCount: 3,
    startMonth: 10, startYear: 2026,
    requestId: 'b9a75845-3675-4f1e-9bf7-09c23e17a71f',
  };
  const created = await c('POST', '/vehicles/expenses', expenseBody);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.data.paymentMethod, 'card');
  assert.equal(created.json.data.cardId, card.id);
  assert.equal(created.json.data.installmentCount, 3);
  assert.equal(created.json.data.startMonth, 10);
  assert.equal(created.json.data.startYear, 2026);
  const retried = await c('POST', '/vehicles/expenses', expenseBody);
  assert.equal(retried.status, 201, retried.text);
  assert.equal(retried.json.data.id, created.json.data.id);

  const purchases = await c('GET', '/purchases');
  assert.equal(purchases.json.total, 1);
  assert.equal(purchases.json.data[0].vehicleExpenseId, created.json.data.id);
  assert.equal(purchases.json.data[0].count, 3);
  const cashEntries = await c('GET', '/cash-ledger/entries?all=true');
  assert.equal(cashEntries.json.data.some((item) => item.vehicleExpenseId === created.json.data.id), false);
  const installments = await c('GET', '/purchases/installments?month=11&year=2026');
  assert.deepEqual(installments.json.data.map((item) => item.amount), [33.34]);
  const budget = await c(`GET`, `/budgets?personId=${ids['Pessoa 01']}&year=2026&month=11`);
  assert.equal(budget.json.data.monthly.purchases.length, 1);
  assert.equal(budget.json.data.monthly.purchases[0].amount, 33.34);
  assert.equal(budget.json.data.monthly.purchases[0].category, 'Vale combustível');
  assert.equal(budget.json.data.sections.find((section) => section.key === 'vehicle').rows.some((row) => row.computed), false);
  const dashboardNovember = (await c('GET', `/dashboard/summary?month=11&year=2026&personId=${ids['Pessoa 01']}`)).json.data;
  assert.equal(dashboardNovember.totals.month, 33.34);
  assert.equal(dashboardNovember.people.find((person) => person.id === ids['Pessoa 01']).month, 33.34);
  assert.equal(dashboardNovember.series[10].amount, 33.34);
  assert.equal(dashboardNovember.byCategory.find((category) => category.name === 'Vale combustível').amount, 33.34);
  const dashboardOctober = (await c('GET', `/dashboard/summary?month=10&year=2026&personId=${ids['Pessoa 01']}`)).json.data;
  assert.equal(dashboardOctober.totals.month, 0);
  const cards = await c('GET', '/cards?month=10&year=2026');
  assert.equal(cards.json.data.find((item) => item.id === card.id).used, 66.67);

  assert.equal((await c('DELETE', `/purchases/${purchases.json.data[0].id}`)).status, 409);
  assert.equal((await c('PATCH', `/purchases/installments/${installments.json.data[0].id}`, { paid: true })).status, 200);
  assert.equal((await c('GET', '/cards?month=10&year=2026')).json.data.find((item) => item.id === card.id).used, 66.67);
  const updated = await c('PUT', `/vehicles/expenses/${created.json.data.id}`, { ...expenseBody, date: '2026-10-23', amount: 90, installmentCount: 2, startMonth: 11 });
  assert.equal(updated.status, 200, updated.text);
  assert.equal((await c('GET', '/purchases')).json.total, 1);
  assert.equal((await c('GET', '/purchases')).json.data[0].count, 2);
  assert.equal(updated.json.data.startMonth, 11);
  assert.equal(updated.json.data.startYear, 2026);
  const rescheduled = await c('GET', '/purchases/installments?month=12&year=2026');
  assert.equal(rescheduled.json.data[0].paidAmount, 33.34);
  assert.equal((await c('GET', '/cards?month=11&year=2026')).json.data.find((item) => item.id === card.id).used, 56.66);
  assert.equal((await c('DELETE', `/vehicles/expenses/${created.json.data.id}`)).status, 204);
  assert.equal((await c('GET', '/purchases')).json.total, 0);
  assert.equal((await c('GET', '/cards?month=11&year=2026')).json.data.find((item) => item.id === card.id).used, 0);
});

test('despesa compartilhada no cartão distribui cada parcela e não duplica o total', async () => {
  const { c, ids } = await setup('v7@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const card = (await c('POST', '/cards', { name: 'Cartão compartilhado', limit: 2000, ownerId: ids['Pessoa 01'], closingDay: 22, dueDay: 5 })).json.data;
  const created = await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date: '2026-10-20', category: 'insurance', description: 'Seguro',
    amount: 120, payerId: ids['Pessoa 01'], shared: true, participantIds: [ids['Pessoa 01'], ids['Pessoa 02']],
    paymentMethod: 'card', cardId: card.id, installmentCount: 2, startMonth: 10, startYear: 2026,
  });
  assert.equal(created.status, 201, created.text);
  const installments = await c('GET', '/purchases/installments?month=11&year=2026');
  assert.equal(installments.json.data.length, 2);
  assert.equal(installments.json.data.reduce((sum, row) => sum + row.amount, 0), 60);
  assert.ok(installments.json.data.every((row) => row.vehicleExpenseId === created.json.data.id));
  assert.equal((await c('GET', '/cards?month=10&year=2026')).json.data.find((item) => item.id === card.id).used, 60);
  const allPurchases = await c('GET', '/purchases');
  assert.equal(allPurchases.json.total, 1);
  assert.equal(allPurchases.json.data[0].total, 120);
  assert.equal((await c('DELETE', `/purchases/shared/${allPurchases.json.data[0].sharedGroup}`)).status, 409);
});

test('gasto de veículo em 2x ocupa R$ 200 e pagar a primeira parcela libera R$ 100', async () => {
  const { c, ids } = await setup('vehicle-card-limit@teste.com');
  const vehicle = (await c('POST', '/vehicles', car)).json.data;
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const closingDay = today.getDate();
  const duePeriod = getInvoiceDuePeriod({ closingDay, dueDay: 5 }, year, month);
  const card = (await c('POST', '/cards', {
    name: 'Cartão óleo', limit: 500, ownerId: ids['Pessoa 01'], closingDay, dueDay: 5, closingDayEqual: 'current',
  })).json.data;
  const expense = await c('POST', '/vehicles/expenses', {
    vehicleId: vehicle.id, date, category: 'oil', description: 'Troca de óleo',
    amount: 200, payerId: ids['Pessoa 01'], paymentMethod: 'card', cardId: card.id, installmentCount: 2,
  });
  assert.equal(expense.status, 201, expense.text);
  assert.equal((await c('GET', `/cards?month=${month}&year=${year}`)).json.data.find((item) => item.id === card.id).used, 200);

  const currentInstallments = await c('GET', `/purchases/installments?month=${duePeriod.month}&year=${duePeriod.year}`);
  assert.equal(currentInstallments.json.data.length, 1);
  assert.equal(currentInstallments.json.data[0].amount, 100);
  assert.equal((await c('PATCH', `/purchases/installments/${currentInstallments.json.data[0].id}`, { paid: true })).status, 200);
  assert.equal((await c('GET', `/cards?month=${month}&year=${year}`)).json.data.find((item) => item.id === card.id).used, 100);
});
