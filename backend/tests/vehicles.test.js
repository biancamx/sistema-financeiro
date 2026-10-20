import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const { openDb } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

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

// usuário novo (workspace vazio) com 3 pessoas
async function setup(email) {
  const c = client();
  const reg = await c('POST', '/auth/register', { name: 'Teste', email, password: 'senha-forte-123' });
  assert.equal(reg.status, 201, reg.text);
  const ids = {};
  for (const n of ['Ana', 'Beto', 'Caio']) ids[n] = (await c('POST', '/people', { name: n })).json.data.id;
  return { c, ids };
}
const car = { kind: 'car', model: 'Chevrolet Ônix', plate: 'abc-1d23', year: 2021, purchaseValue: 62000, status: 'active' };

test('cadastra veículos, normaliza a placa e bloqueia placa repetida', async () => {
  const { c } = await setup('v1@teste.com');
  const v = await c('POST', '/vehicles', car);
  assert.equal(v.status, 201, v.text);
  assert.equal(v.json.data.plate, 'ABC1D23');
  assert.equal(v.json.data.totalSpent, 0);
  assert.equal((await c('POST', '/vehicles', { ...car, plate: 'ABC 1D23' })).status, 409);
  assert.equal((await c('POST', '/vehicles', { ...car, plate: '!!' })).status, 400);
  const moto = await c('POST', '/vehicles', { kind: 'motorcycle', model: 'Honda CG 160', plate: 'XYZ9A87', year: 2020, purchaseValue: 14000 });
  assert.equal(moto.status, 201);
  const list = (await c('GET', '/vehicles')).json.data;
  assert.deepEqual(list.map((x) => x.model).sort(), ['Chevrolet Ônix', 'Honda CG 160']);
  const up = await c('PUT', `/vehicles/${v.json.data.id}`, { ...car, plate: 'ABC1D23', status: 'sold' });
  assert.equal(up.json.data.status, 'sold');
});

test('gasto individual: valor mínimo R$ 1, categoria válida, km e fatia do pagador', async () => {
  const { c, ids } = await setup('v2@teste.com');
  const v = (await c('POST', '/vehicles', car)).json.data;
  const base = { vehicleId: v.id, date: '2026-03-10', category: 'fuel', description: 'Gasolina', amount: 250.5, km: 41200, payerId: ids.Ana };
  const ok = await c('POST', '/vehicles/expenses', base);
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.data.shared, false);
  assert.deepEqual(ok.json.data.shares.map((s) => [s.person, s.amount]), [['Ana', 250.5]]);
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
  assert.equal(got.currentKm, 41200);
});

test('rateio: iguais fecham no centavo, por % e por R$; erros de soma', async () => {
  const { c, ids } = await setup('v3@teste.com');
  const v = (await c('POST', '/vehicles', car)).json.data;
  const sh = { vehicleId: v.id, date: '2026-04-01', category: 'insurance', description: 'Seguro anual', amount: 100, payerId: ids.Ana, shared: true };
  const eq = (await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'equal', participantIds: [ids.Ana, ids.Beto, ids.Caio] })).json.data;
  const total = (s) => Math.round(s.reduce((a, x) => a + x.amount * 100, 0));
  assert.equal(total(eq.shares), 10000);
  assert.deepEqual(eq.shares.map((s) => s.amount).sort(), [33.33, 33.33, 33.34]);

  const pct = await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'percent', participants: [{ personId: ids.Ana, value: 50 }, { personId: ids.Beto, value: 30 }, { personId: ids.Caio, value: 20 }] });
  assert.deepEqual(pct.json.data.shares.map((s) => [s.person, s.amount]), [['Ana', 50], ['Beto', 30], ['Caio', 20]]);

  const amt = await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'amount', participants: [{ personId: ids.Ana, value: 70 }, { personId: ids.Beto, value: 30 }] });
  assert.equal(amt.status, 201, amt.text);

  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'percent', participants: [{ personId: ids.Ana, value: 50 }, { personId: ids.Beto, value: 30 }] })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, splitMode: 'amount', participants: [{ personId: ids.Ana, value: 70 }, { personId: ids.Beto, value: 20 }] })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, participantIds: [ids.Ana] })).status, 400);
  assert.equal((await c('POST', '/vehicles/expenses', { ...sh, participantIds: [ids.Ana, ids.Ana] })).status, 400);

  // editar troca o rateio por completo; virar individual deixa só o pagador
  const id = eq.id;
  const ed = await c('PUT', `/vehicles/expenses/${id}`, { ...sh, shared: false });
  assert.deepEqual(ed.json.data.shares.map((s) => [s.person, s.amount]), [['Ana', 100]]);
});

test('painel: totais, categorias, meses e saldo de quem pagou × quem deve', async () => {
  const { c, ids } = await setup('v4@teste.com');
  const a = (await c('POST', '/vehicles', car)).json.data;
  const b = (await c('POST', '/vehicles', { ...car, kind: 'motorcycle', model: 'Honda', plate: 'HND1A11' })).json.data;
  const mk = (o) => c('POST', '/vehicles/expenses', { date: '2026-01-15', description: '', ...o });
  await mk({ vehicleId: a.id, category: 'ipva', amount: 900, payerId: ids.Ana }); // individual da Ana
  await mk({ vehicleId: a.id, category: 'fuel', amount: 200, payerId: ids.Ana, shared: true, participantIds: [ids.Ana, ids.Beto], km: 1000 });
  await mk({ vehicleId: b.id, category: 'oil', amount: 100, payerId: ids.Beto, date: '2025-12-02', km: 500 });
  await mk({ vehicleId: a.id, category: 'tires', amount: 400, payerId: ids.Caio, km: 3000 });

  const fleet = (await c('GET', '/vehicles/summary?year=2026')).json.data;
  assert.equal(fleet.total, 1500);
  assert.equal(fleet.byMonth.length, 12);
  assert.equal(fleet.byMonth[0].total, 1500);
  assert.deepEqual(fleet.byGroup.map((g) => [g.key, g.total]), [['fixed', 900], ['maintenance', 400], ['operational', 200]]);
  const pessoa = (n) => fleet.people.find((p) => p.name === n);
  assert.deepEqual([pessoa('Ana').paid, pessoa('Ana').owes, pessoa('Ana').balance], [1100, 1000, 100]);
  assert.deepEqual([pessoa('Beto').paid, pessoa('Beto').owes, pessoa('Beto').balance], [0, 100, -100]);
  assert.equal(pessoa('Caio').balance, 0);

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
  assert.equal((await q(`personId=${ids.Beto}`)).total, 2); // pagou o óleo + divide o combustível
  assert.equal((await q('year=2025')).total, 1);
  assert.equal((await q('from=2026-01-01&to=2026-01-31')).total, 3);
  const csv = (await c('GET', '/vehicles/expenses/export.csv')).text;
  assert.equal(csv.split('\n').length, 5);
});

test('excluir: veículo com histórico exige force; pessoa com gasto não pode ser apagada', async () => {
  const { c, ids } = await setup('v5@teste.com');
  const v = (await c('POST', '/vehicles', car)).json.data;
  const e = (await c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-05-05', category: 'wash', amount: 30, payerId: ids.Caio })).json.data;
  assert.equal((await c('DELETE', `/people/${ids.Caio}`)).status, 409);
  assert.equal((await c('DELETE', `/vehicles/${v.id}`)).status, 409);
  assert.equal((await c('DELETE', `/vehicles/expenses/${e.id}`)).status, 204);
  assert.equal((await c('DELETE', `/people/${ids.Caio}`)).status, 204);
  await c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-05-05', category: 'wash', amount: 30, payerId: ids.Ana });
  assert.equal((await c('DELETE', `/vehicles/${v.id}?force=true`)).status, 204);
  assert.equal((await c('GET', '/vehicles/expenses')).json.total, 0); // histórico foi junto
});

test('isolamento: outro usuário não vê nem mexe nos veículos e gastos', async () => {
  const a = await setup('iso-a@teste.com');
  const b = await setup('iso-b@teste.com');
  const v = (await a.c('POST', '/vehicles', car)).json.data;
  const e = (await a.c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-06-06', category: 'fuel', amount: 80, payerId: a.ids.Ana })).json.data;
  assert.equal((await b.c('GET', '/vehicles')).json.data.length, 0);
  assert.equal((await b.c('GET', `/vehicles/${v.id}`)).status, 404);
  assert.equal((await b.c('GET', `/vehicles/expenses/${e.id}`)).status, 404);
  assert.equal((await b.c('PUT', `/vehicles/expenses/${e.id}`, { vehicleId: v.id, date: '2026-06-06', category: 'fuel', amount: 1, payerId: b.ids.Ana })).status, 404);
  assert.equal((await b.c('DELETE', `/vehicles/expenses/${e.id}`)).status, 404);
  assert.equal((await b.c('POST', '/vehicles/expenses', { vehicleId: v.id, date: '2026-06-06', category: 'fuel', amount: 5, payerId: b.ids.Ana })).status, 400);
  assert.equal((await b.c('POST', '/vehicles/expenses', { vehicleId: (await b.c('POST', '/vehicles', car)).json.data.id, date: '2026-06-06', category: 'fuel', amount: 5, payerId: a.ids.Ana })).status, 400);
  assert.equal((await b.c('GET', `/vehicles/summary?vehicleId=${v.id}`)).status, 404);
  assert.equal((await b.c('GET', '/vehicles/summary')).json.data.total, 0);
  assert.equal((await a.c('GET', '/vehicles')).json.data[0].totalSpent, 80);
});

test('exige login', async () => {
  const c = client();
  assert.equal((await c('GET', '/vehicles')).status, 401);
  assert.equal((await c('GET', '/vehicles/expenses')).status, 401);
});
