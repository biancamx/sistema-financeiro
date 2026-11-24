import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-category-import';
process.env.AI_KEY_SECRET = 'c'.repeat(64);
process.env.ALLOWED_DOMAINS = '';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.ENABLE_LOCAL_LOGIN = 'true';

const [{ createApp }] = await Promise.all([import('../src/app.js')]);
let stopMongo;
let server;
let baseUrl;
const originalFetch = globalThis.fetch;

before(async () => {
  stopMongo = await startMongoMemory();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(clearMongoMemory);

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (stopMongo) await stopMongo();
});

test('prévia de categorias em PDF separa novas das já cadastradas e importa sem duplicar', async () => {
  const account = await createTestAccount({ email: 'category-import@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const configured = await api('PUT', '/settings/ai', {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: 'AIza-category-import-test-key',
    consent: true,
  });
  assert.equal(configured.status, 200, configured.text);

  globalThis.fetch = (url, options) => (
    String(url).startsWith(baseUrl)
      ? originalFetch(url, options)
      : Promise.resolve(new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ categories: ['Alimentação', 'Reserva', 'reserva'] }) }], role: 'model' },
          finishReason: 'STOP',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  );

  const formData = new FormData();
  formData.append('file', new Blob(['%PDF-1.4 test document'], { type: 'application/pdf' }), 'categorias.pdf');
  const previewResponse = await fetch(`${baseUrl}/categories/import/preview`, {
    method: 'POST',
    headers: { Cookie: account.cookie, Origin: 'http://localhost:5173' },
    body: formData,
  });
  const preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200, JSON.stringify(preview));
  assert.deepEqual(preview.data.newCategories, ['Reserva']);
  assert.deepEqual(preview.data.alreadyExists, ['Alimentação']);

  const imported = await api('POST', '/categories/import', {
    names: [...preview.data.newCategories, 'reserva'],
  });
  assert.equal(imported.status, 201, imported.text);
  assert.equal(imported.json.data.createdCount, 1);
  assert.deepEqual(imported.json.data.createdNames, ['Reserva']);

  const categories = await api('GET', '/categories');
  assert.equal(categories.json.data.filter(({ name }) => name.toLowerCase() === 'reserva').length, 1);
});

test('prévia de categorias rejeita arquivos que não sejam PDF', async () => {
  const account = await createTestAccount({ email: 'category-import-invalid@example.invalid' });
  const formData = new FormData();
  formData.append('file', new Blob(['not a PDF'], { type: 'application/pdf' }), 'categorias.pdf');
  const response = await fetch(`${baseUrl}/categories/import/preview`, {
    method: 'POST',
    headers: { Cookie: account.cookie, Origin: 'http://localhost:5173' },
    body: formData,
  });
  const result = await response.json();
  assert.equal(response.status, 400, JSON.stringify(result));
  assert.equal(result.error.code, 'CATEGORY_PDF_INVALID');
});
