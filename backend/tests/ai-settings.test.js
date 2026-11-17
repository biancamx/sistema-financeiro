import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { clearMongoMemory, createApiClient, createTestAccount, startMongoMemory } from './helpers/mongo.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-ai-settings';
process.env.AI_KEY_SECRET = 'b'.repeat(64);
process.env.ALLOWED_DOMAINS = '';
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.ENABLE_LOCAL_LOGIN = 'true';

const [{ createApp }, { User }, { decryptAiApiKey }, { processUserMessage }, { analyzePdfDocument }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/modules/settings/ai-crypto.js'),
  import('../src/modules/assistant/assistant.service.js'),
  import('../src/modules/import/pdf.reader.js'),
]);

const PROVIDERS = [
  ['gemini', 'gemini-2.5-flash', 'AIza-gemini-secret-key-1234'],
  ['openai', 'gpt-4o-mini', 'sk-openai-secret-key-5678'],
  ['anthropic', 'claude-haiku-4-5', 'sk-ant-anthropic-key-9012'],
];

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

function providerResponse(provider, status = 200, text = 'OK') {
  const body = provider === 'gemini'
    ? { candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }] }
    : provider === 'openai'
      ? { output_text: text, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
      : { content: [{ type: 'text', text }] };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockProviderFetch(handler) {
  globalThis.fetch = (url, options) => (
    String(url).startsWith(baseUrl) ? originalFetch(url, options) : handler(url, options)
  );
}

async function saveConfig(api, [provider, model, apiKey]) {
  return api('PUT', '/settings/ai', { provider, model, apiKey, consent: true });
}

test('configurações de IA exigem autenticação', async () => {
  const anonymous = createApiClient(baseUrl);
  assert.equal((await anonymous('GET', '/settings/ai')).status, 401);
});

test('modelos Gemini atuais ficam disponíveis para seleção e teste', async () => {
  const account = await createTestAccount({ email: 'ai-gemini-models@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const settings = await api('GET', '/settings/ai');
  const models = settings.json.data.providers.gemini.models;
  for (const model of [
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.8-flash',
    'gemini-4-hydrogen',
    'gemini-4-argon',
    'gemini-4-carbon',
  ]) assert.ok(models.includes(model), `${model} deve estar disponível`);

  const saved = await saveConfig(api, ['gemini', 'gemini-4-hydrogen', 'AIza-gemini-new-model-key']);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.data.model, 'gemini-4-hydrogen');

  let requestedUrl = '';
  mockProviderFetch(async (url) => {
    requestedUrl = String(url);
    return providerResponse('gemini');
  });
  const tested = await api('POST', '/settings/ai/test', {
    provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'AIza-gemini-new-model-key',
  });
  assert.equal(tested.status, 200, tested.text);
  assert.ok(requestedUrl.includes('gemini-3.5-flash-lite'));

  mockProviderFetch(async () => new Response(JSON.stringify({ error: { message: 'invalid model turn' } }), { status: 400 }));
  const failedChat = await api('POST', '/assistant/chat', { message: 'Resumo deste mês' });
  assert.equal(failedChat.status, 422);
  const persisted = await api('GET', '/settings/ai');
  assert.equal(persisted.json.data.configured, true);
  assert.equal(persisted.json.data.provider, 'gemini');
  assert.equal(persisted.json.data.model, 'gemini-4-hydrogen');
  assert.equal(persisted.json.data.last4, '-key');
});

test('salva Gemini, OpenAI e Claude criptografados e troca provedor/modelo', async () => {
  const account = await createTestAccount({ email: 'ai-settings@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);

  for (const [provider, model, apiKey] of PROVIDERS) {
    const saved = await saveConfig(api, [provider, model, apiKey]);
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.data.provider, provider);
    assert.equal(saved.json.data.model, model);
    assert.equal(saved.json.data.last4, apiKey.slice(-4));
    assert.equal(JSON.stringify(saved.json).includes(apiKey), false);
    assert.equal(JSON.stringify(saved.json).includes('aiApiKeyEncrypted'), false);

    const current = await api('GET', '/settings/ai');
    assert.equal(current.json.data.provider, provider);
    assert.equal(current.json.data.model, model);
    assert.equal(current.json.data.last4, apiKey.slice(-4));

    const stored = await User.findById(account.user._id).select('+aiApiKeyEncrypted').lean();
    assert.notEqual(stored.aiApiKeyEncrypted, apiKey);
    assert.equal(stored.aiApiKeyEncrypted.includes(apiKey), false);
    assert.equal(decryptAiApiKey(stored.aiApiKeyEncrypted), apiKey);
  }

  await saveConfig(api, PROVIDERS[1]);
  const updatedModel = await api('PUT', '/settings/ai', {
    provider: 'openai',
    model: 'gpt-4o',
    consent: true,
  });
  assert.equal(updatedModel.status, 200, updatedModel.text);
  assert.equal(updatedModel.json.data.model, 'gpt-4o');
  assert.equal(updatedModel.json.data.last4, PROVIDERS[1][2].slice(-4));
});

test('isolamento por usuário, persistência após logout/login e remoção', async () => {
  const owner = await createTestAccount({ email: 'ai-owner@example.invalid' });
  const other = await createTestAccount({ email: 'ai-other@example.invalid' });
  const ownerApi = createApiClient(baseUrl, owner.cookie);
  const otherApi = createApiClient(baseUrl, other.cookie);
  const [provider, model, apiKey] = PROVIDERS[1];

  await saveConfig(ownerApi, [provider, model, apiKey]);
  const isolated = await otherApi('GET', '/settings/ai');
  assert.equal(isolated.json.data.configured, false);
  assert.equal(isolated.json.data.last4, null);

  owner.user.passwordHash = await bcrypt.hash('test-password-123', 4);
  await owner.user.save();
  await ownerApi('POST', '/auth/logout');
  const login = await ownerApi('POST', '/auth/login', {
    email: owner.user.email,
    password: 'test-password-123',
  });
  assert.equal(login.status, 200, login.text);
  const afterLogin = await ownerApi('GET', '/settings/ai');
  assert.equal(afterLogin.json.data.last4, apiKey.slice(-4));

  const consent = await ownerApi('PATCH', '/settings/ai/consent', { consent: false });
  assert.equal(consent.json.data.consentGiven, false);
  await assert.rejects(() => processUserMessage({
    userId: String(owner.user._id),
    message: 'Olá',
  }), { code: 'AI_CONSENT_REQUIRED' });

  const removed = await ownerApi('DELETE', '/settings/ai');
  assert.equal(removed.status, 200);
  assert.equal((await ownerApi('GET', '/settings/ai')).json.data.configured, false);
});

test('teste de chave diferencia credencial válida e rejeitada nos três provedores', async () => {
  const account = await createTestAccount({ email: 'ai-test-key@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);

  for (const config of PROVIDERS) {
    const [provider, model, apiKey] = config;
    mockProviderFetch(async () => providerResponse(provider));
    const valid = await api('POST', '/settings/ai/test', { provider, model, apiKey });
    assert.equal(valid.status, 200, valid.text);
    assert.equal(valid.json.data.valid, true);

    mockProviderFetch(async () => providerResponse(provider, 401));
    const invalid = await api('POST', '/settings/ai/test', { provider, model, apiKey });
    assert.equal(invalid.status, 422, invalid.text);
    assert.match(invalid.json.error.message, /recusou a chave/);
  }

  const invalidModel = await api('POST', '/settings/ai/test', {
    provider: 'openai', model: 'https://attacker.invalid', apiKey: 'secret-key-for-test',
  });
  assert.equal(invalidModel.status, 400);
});

test('assistente usa somente o provedor salvo por aquele usuário e exige configuração', async () => {
  const account = await createTestAccount({ email: 'ai-assistant@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  await assert.rejects(() => processUserMessage({
    userId: String(account.user._id),
    message: 'Olá',
  }), { code: 'AI_NOT_CONFIGURED' });

  const [, , apiKey] = PROVIDERS[2];
  await saveConfig(api, PROVIDERS[2]);
  let observedRequest;
  mockProviderFetch(async (url, options) => {
    observedRequest = { url: String(url), options };
    return providerResponse('anthropic', 200, 'Resposta do Claude');
  });
  const result = await api('POST', '/assistant/chat', { message: 'Olá' });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.reply, 'Resposta do Claude');
  assert.equal(observedRequest.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(observedRequest.options.headers['x-api-key'], apiKey);
});

test('adapta chamadas de ferramentas do assistente nos três provedores', async () => {
  const account = await createTestAccount({ email: 'ai-tools@example.invalid' });

  for (const [provider, model, apiKey] of PROVIDERS) {
    const api = createApiClient(baseUrl, account.cookie);
    await saveConfig(api, [provider, provider === 'gemini' ? 'gemini-4-hydrogen' : model, apiKey]);
    let requests = 0;
    let geminiModelTurn;
    let geminiToolReply;
    mockProviderFetch(async (_url, options) => {
      requests += 1;
      const request = JSON.parse(options.body);
      if (provider === 'gemini') {
        if (requests === 1) {
          return new Response(JSON.stringify({
            candidates: [{
              content: {
                role: 'model',
                parts: [{
                  functionCall: { name: 'listarPessoas', args: {} },
                  thoughtSignature: 'opaque-gemini-thought-signature',
                }],
              },
              finishReason: 'STOP',
            }],
          }), { status: 200 });
        }
        geminiModelTurn = request.contents.find((content) => content.role === 'model');
        geminiToolReply = request.contents.find((content) => content.parts.some((part) => part.functionResponse));
        return providerResponse(provider, 200, 'Pessoas consultadas.');
      }
      if (provider === 'openai') {
        if (requests === 1) {
          return new Response(JSON.stringify({
            output: [{ type: 'function_call', call_id: 'tool-call-1', name: 'listarPessoas', arguments: '{}' }],
          }), { status: 200 });
        }
        assert.ok(request.input.some((item) => item.type === 'function_call_output'));
        return providerResponse(provider, 200, 'Pessoas consultadas.');
      }
      if (requests === 1) {
        return new Response(JSON.stringify({
          content: [{ type: 'tool_use', id: 'tool-call-1', name: 'listarPessoas', input: {} }],
        }), { status: 200 });
      }
      assert.ok(request.messages.some((item) => item.content.some((block) => block.type === 'tool_result')));
      return providerResponse(provider, 200, 'Pessoas consultadas.');
    });

    const result = await processUserMessage({
      userId: String(account.user._id),
      message: 'Liste as pessoas cadastradas.',
    });
    assert.equal(result.reply, 'Pessoas consultadas.');
    assert.equal(requests, 2);
    if (provider === 'gemini') {
      assert.equal(geminiModelTurn.parts[0].thoughtSignature, 'opaque-gemini-thought-signature');
      assert.equal(geminiToolReply.parts.length, 1);
      assert.equal(geminiToolReply.parts[0].functionResponse.name, 'listarPessoas');
      assert.ok(Array.isArray(geminiToolReply.parts[0].functionResponse.response.result));
      const saved = await api('GET', '/settings/ai');
      assert.equal(saved.json.data.configured, true);
      assert.equal(saved.json.data.model, 'gemini-4-hydrogen');
      assert.equal(saved.json.data.last4, apiKey.slice(-4));
    }
  }
});

test('análise de PDF usa o provedor/modelo individual e falha claramente sem chave', async () => {
  const account = await createTestAccount({ email: 'ai-pdf@example.invalid' });
  const pdf = Buffer.from('%PDF-1.7\nconteúdo de teste');
  await assert.rejects(
    () => analyzePdfDocument(pdf, String(account.user._id)),
    { code: 'AI_NOT_CONFIGURED' },
  );

  const [provider, model, apiKey] = PROVIDERS[1];
  await User.findByIdAndUpdate(account.user._id, {
    aiProvider: provider,
    aiModel: model,
    aiApiKeyEncrypted: (await import('../src/modules/settings/ai-crypto.js')).encryptAiApiKey(apiKey),
    aiDataConsentAt: new Date(),
  });
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, amount: null }));
  let requests = 0;
  mockProviderFetch(async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.input.some((item) => item.content?.some((part) => part.type === 'input_file')), true);
    requests += 1;
    const text = requests === 1
      ? '{"documentType":"annual_budget"}'
      : JSON.stringify({ truncated: false, records: [{ person: 'Imported person', year: 2026, section: 'moradia', label: 'Rent', months }] });
    return providerResponse('openai', 200, text);
  });

  const result = await analyzePdfDocument(pdf, String(account.user._id));
  assert.equal(result.documentType, 'annual_budget');
  assert.equal(result.monthlyBudgets[0].label, 'Rent');
  assert.equal(requests, 2);
});
