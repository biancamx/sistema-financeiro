import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';
import { Person, hashPortalToken } from '../src/models/Person.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { migrateLegacyPortalTokens } from '../src/lib/migratePortalTokens.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-portal-security';
process.env.ENABLE_LOCAL_LOGIN = 'true';
process.env.RATE_LIMIT_MAX = '100000';

const { createApp } = await import('../src/app.js');

let server;
let base;
let stopMongo;

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
  return { ...account, client: createApiClient(base, account.cookie) };
}

test('portal entrega token aleatório uma única vez, guarda somente o hash e permite revogar e renovar', async () => {
  const { user, person, client } = await setup('portal-owner@test.invalid');
  const created = await client('POST', `/people/${person._id}/share-link`);
  assert.equal(created.status, 200, created.text);
  const token = created.json.data.token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(created.json.data.expiresAt) > new Date());

  const stored = await Person.findById(person._id).select('+shareTokenHash').lean();
  assert.equal(stored.shareToken, undefined);
  assert.equal(stored.shareTokenHash, hashPortalToken(token));
  assert.equal((await client('GET', '/people')).json.data[0].share_token, null);
  const audit = await AuditEvent.findOne({ eventType: 'share.link.created', targetId: String(person._id) }).lean();
  assert.equal(audit.actorUserId.toString(), String(user._id));
  assert.equal(JSON.stringify(audit).includes(token), false);
  await assert.rejects(
    AuditEvent.updateOne({ _id: audit._id }, { $set: { targetId: 'tampered' } }),
    /append-only/,
  );

  assert.equal((await client('GET', `/portal/${token}`)).status, 200);
  const rotated = await client('POST', `/people/${person._id}/share-link`);
  assert.equal(rotated.status, 200);
  assert.equal((await client('GET', `/portal/${token}`)).status, 404);
  const newToken = rotated.json.data.token;
  assert.equal((await client('GET', `/portal/${newToken}`)).status, 200);
  assert.equal(String((await Person.findById(person._id)).userId), String(user._id));

  assert.equal((await client('DELETE', `/people/${person._id}/share-link`)).status, 204);
  assert.equal((await client('GET', `/portal/${newToken}`)).status, 404);
});

test('portal impede outro usuário de criar ou revogar o link do proprietário', async () => {
  const owner = await setup('portal-owner2@test.invalid');
  const other = await setup('portal-other@test.invalid');
  const created = await owner.client('POST', `/people/${owner.person._id}/share-link`);
  const token = created.json.data.token;

  assert.equal((await other.client('POST', `/people/${owner.person._id}/share-link`)).status, 404);
  assert.equal((await other.client('DELETE', `/people/${owner.person._id}/share-link`)).status, 404);
  assert.equal((await owner.client('GET', `/portal/${token}`)).status, 200);
});

test('requisições rejeitam campos de privilégio inesperados', async () => {
  const { person, client } = await setup('portal-mass-assignment@test.invalid');
  const response = await client('PUT', `/people/${person._id}`, {
    name: 'Nome não aplicado',
    role: 'admin',
  });
  assert.equal(response.status, 400);
  assert.equal((await Person.findById(person._id)).name, 'Test person');
});

test('portal rejeita link expirado e migra tokens legados para hash sem perder o acesso', async () => {
  const { person, client } = await setup('portal-legacy@test.invalid');
  person.shareToken = 'Abcdef234567';
  await person.save();

  assert.equal(await migrateLegacyPortalTokens(), 1);
  const migrated = await Person.findById(person._id).select('+shareTokenHash').lean();
  assert.equal(migrated.shareToken, undefined);
  assert.equal(migrated.shareTokenHash, hashPortalToken('Abcdef234567'));
  assert.equal((await client('GET', '/portal/Abcdef234567')).status, 200);

  await Person.updateOne({ _id: person._id }, { $set: { shareTokenExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await client('GET', '/portal/Abcdef234567')).status, 404);
  assert.equal(await migrateLegacyPortalTokens(), 0);
});

test('respostas da API aplicam CSP restrita e cache no-store', async () => {
  const response = await fetch(`${base}/system/health`);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /style-src-attr 'unsafe-inline'/);

  const { person, client } = await setup('portal-cache@test.invalid');
  const link = await client('POST', `/people/${person._id}/share-link`);
  assert.equal(link.headers.get('cache-control'), 'no-store');
  const portal = await fetch(`${base}/portal/${link.json.data.token}`);
  assert.equal(portal.headers.get('cache-control'), 'no-store');
});
