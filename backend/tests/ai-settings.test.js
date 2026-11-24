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

const [{ createApp }, { User }, { decryptAiApiKey }, { processUserMessage }, { analyzePdfDocument }, { env }] = await Promise.all([
  import('../src/app.js'),
  import('../src/models/User.js'),
  import('../src/modules/settings/ai-crypto.js'),
  import('../src/modules/assistant/assistant.service.js'),
  import('../src/modules/import/pdf.reader.js'),
  import('../src/config/env.js'),
]);
const [
  { executarFerramenta, toolsDeclaration },
  { Card },
  { Category },
  { BudgetSheet },
  { CashEntry },
  { CashInstallment },
  { Installment },
  { Person },
  { Purchase },
] = await Promise.all([
  import('../src/modules/assistant/assistant.tools.js'),
  import('../src/models/Card.js'),
  import('../src/models/Category.js'),
  import('../src/models/BudgetSheet.js'),
  import('../src/models/CashEntry.js'),
  import('../src/models/CashInstallment.js'),
  import('../src/models/Installment.js'),
  import('../src/models/Person.js'),
  import('../src/models/Purchase.js'),
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
  mockProviderFetch(async () => providerResponse(provider));
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

    mockProviderFetch(async () => providerResponse(provider, 503));
    const unavailable = await api('POST', '/settings/ai/test', { provider, model, apiKey });
    assert.equal(unavailable.status, 502, unavailable.text);
    assert.equal(unavailable.json.error.code, 'AI_PROVIDER_UNAVAILABLE');
  }

  const invalidModel = await api('POST', '/settings/ai/test', {
    provider: 'openai', model: 'https://attacker.invalid', apiKey: 'secret-key-for-test',
  });
  assert.equal(invalidModel.status, 400);
});

test('salvar configurações valida a chave antes de persistir', async () => {
  const account = await createTestAccount({ email: 'ai-invalid-save@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const apiKey = 'AIza-invalid-key-must-not-be-saved';
  mockProviderFetch(async () => providerResponse('gemini', 401));

  const response = await api('PUT', '/settings/ai', {
    provider: 'gemini', model: 'gemini-4-hydrogen', apiKey, consent: true,
  });
  assert.equal(response.status, 422);
  assert.equal(response.json.error.code, 'AI_KEY_REJECTED');
  assert.equal(JSON.stringify(response.json).includes(apiKey), false);
  assert.equal((await api('GET', '/settings/ai')).json.data.configured, false);
});

test('Gemini atende com payload válido e repete 503/429 até o limite', async () => {
  const account = await createTestAccount({ email: 'ai-gemini-retry@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  await saveConfig(api, ['gemini', 'gemini-4-hydrogen', 'AIza-gemini-retry-test-key']);

  let attempts = 0;
  let requestUrl = '';
  let requestBody;
  mockProviderFetch(async (url, options) => {
    attempts += 1;
    requestUrl = String(url);
    requestBody = JSON.parse(options.body);
    return attempts < 3
      ? providerResponse('gemini', 503)
      : providerResponse('gemini', 200, 'Resposta Gemini');
  });
  const success = await api('POST', '/assistant/chat', { message: 'Olá, Gemini' });
  assert.equal(success.status, 200, success.text);
  assert.equal(success.json.reply, 'Resposta Gemini');
  assert.equal(attempts, 3);
  assert.match(requestUrl, /\/v1\/models\/gemini-4-hydrogen:generateContent/);
  assert.deepEqual(requestBody.contents, [{ role: 'user', parts: [{ text: 'Olá, Gemini' }] }]);
  assert.ok(requestBody.systemInstruction);

  attempts = 0;
  mockProviderFetch(async () => {
    attempts += 1;
    return providerResponse('gemini', 429);
  });
  const limited = await api('POST', '/assistant/chat', { message: 'Outra tentativa' });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, 'AI_PROVIDER_LIMIT');
  assert.equal(attempts, 3);

  attempts = 0;
  mockProviderFetch(async () => {
    attempts += 1;
    return providerResponse('gemini', 503);
  });
  const unavailable = await api('POST', '/assistant/chat', { message: 'Serviço indisponível' });
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.json.error.code, 'AI_PROVIDER_UNAVAILABLE');
  assert.equal(attempts, 3);
});

test('Gemini diferencia modelo inexistente e timeout sem expor a chave', async () => {
  const account = await createTestAccount({ email: 'ai-gemini-model-timeout@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const apiKey = 'AIza-gemini-model-timeout-key';
  await saveConfig(api, ['gemini', 'gemini-4-hydrogen', apiKey]);

  mockProviderFetch(async () => providerResponse('gemini', 404));
  const modelMissing = await api('POST', '/settings/ai/test', {
    provider: 'gemini', model: 'gemini-4-hydrogen', apiKey,
  });
  assert.equal(modelMissing.status, 422);
  assert.equal(modelMissing.json.error.code, 'AI_MODEL_UNAVAILABLE');
  assert.equal(JSON.stringify(modelMissing.json).includes(apiKey), false);

  let attempts = 0;
  mockProviderFetch(async () => {
    attempts += 1;
    throw new DOMException('request timed out', 'AbortError');
  });
  const timedOut = await api('POST', '/assistant/chat', { message: 'Teste de timeout' });
  assert.equal(timedOut.status, 504, timedOut.text);
  assert.equal(timedOut.json.error.code, 'AI_PROVIDER_TIMEOUT');
  assert.equal(attempts, 1);
  assert.equal(JSON.stringify(timedOut.json).includes(apiKey), false);
});

test('fallback configurado é testado e usado após indisponibilidade Gemini', async () => {
  const account = await createTestAccount({ email: 'ai-fallback@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const primaryApiKey = 'AIza-gemini-fallback-test-key';
  await saveConfig(api, ['gemini', 'gemini-4-hydrogen', primaryApiKey]);
  const previous = {
    provider: env.aiFallbackProvider,
    model: env.aiFallbackModel,
    apiKey: env.aiFallbackApiKey,
  };
  env.aiFallbackProvider = 'openai';
  env.aiFallbackModel = 'gpt-4o-mini';
  env.aiFallbackApiKey = 'sk-openai-fallback-test-key';

  let geminiAttempts = 0;
  let openAiRequests = 0;
  mockProviderFetch(async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      geminiAttempts += 1;
      return providerResponse('gemini', 503);
    }
    openAiRequests += 1;
    return providerResponse('openai', 200, 'Resposta via fallback');
  });

  try {
    const response = await api('POST', '/assistant/chat', { message: 'Teste de fallback' });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.reply, 'Resposta via fallback');
    assert.equal(geminiAttempts, 3);
    assert.equal(openAiRequests, 2);
    assert.equal(JSON.stringify(response.json).includes(primaryApiKey), false);
    assert.equal(JSON.stringify(response.json).includes(env.aiFallbackApiKey), false);
  } finally {
    env.aiFallbackProvider = previous.provider;
    env.aiFallbackModel = previous.model;
    env.aiFallbackApiKey = previous.apiKey;
  }
});

test('falha de conexão do Gemini retorna erro específico e preserva a configuração', async () => {
  const account = await createTestAccount({ email: 'ai-gemini-network-error@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  const config = ['gemini', 'gemini-4-hydrogen', 'AIza-gemini-network-test-key'];
  await saveConfig(api, config);
  let attempts = 0;
  mockProviderFetch(async () => {
    attempts += 1;
    throw new TypeError('fetch failed');
  });

  const response = await api('POST', '/assistant/chat', { message: 'Olá' });
  assert.equal(response.status, 502);
  assert.equal(response.json.error.code, 'AI_PROVIDER_UNAVAILABLE');
  assert.match(response.json.error.message, /conectar ao provedor de IA/);
  assert.equal(attempts, 3);

  const saved = await api('GET', '/settings/ai');
  assert.equal(saved.json.data.configured, true);
  assert.equal(saved.json.data.model, config[1]);
  assert.equal(saved.json.data.last4, config[2].slice(-4));
});

test('ferramentas consultam histórico, contas e categorias somente do usuário autenticado', async () => {
  const owner = await createTestAccount({ email: 'ai-financial-tools-owner@example.invalid' });
  const other = await createTestAccount({ email: 'ai-financial-tools-other@example.invalid' });
  const ownerId = String(owner.user._id);
  const otherId = String(other.user._id);
  const [person, card, category, otherPerson, otherCard, otherCategory] = await Promise.all([
    Person.create({ userId: ownerId, name: 'Pessoa dona' }),
    Card.create({ userId: ownerId, name: 'Cartão dono', limit: 1000 }),
    Category.create({ userId: ownerId, name: 'Alimentação', type: 'expense' }),
    Person.create({ userId: otherId, name: 'Pessoa alheia' }),
    Card.create({ userId: otherId, name: 'Cartão alheio', limit: 1000 }),
    Category.create({ userId: otherId, name: 'Categoria alheia', type: 'expense' }),
  ]);
  const purchase = await Purchase.create({
    userId: ownerId,
    personId: person._id,
    cardId: card._id,
    categoryId: category._id,
    description: 'Compra do usuário',
    purchaseDate: '2026-11-10',
    totalAmount: 120,
    totalInstallments: 3,
  });
  await Installment.create({
    userId: ownerId, purchaseId: purchase._id, number: 1, year: 2026, month: 11,
    amount: 40, paidAmount: 10, paid: false,
  });
  const otherPurchase = await Purchase.create({
    userId: otherId,
    personId: otherPerson._id,
    cardId: otherCard._id,
    categoryId: otherCategory._id,
    description: 'Compra de outro usuário',
    purchaseDate: '2026-11-10',
    totalAmount: 80,
    totalInstallments: 1,
  });
  await Installment.create({
    userId: otherId, purchaseId: otherPurchase._id, number: 1, year: 2026, month: 11,
    amount: 80, paidAmount: 0, paid: false,
  });
  await BudgetSheet.create({
    userId: ownerId,
    personId: person._id,
    year: 2026,
    rows: [
      { section: 'income', label: 'Salário', cells: [{ month: 11, value: 5000 }] },
      { section: 'housing', label: 'Energia', cells: [{ month: 11, value: 200 }] },
    ],
  });
  await CashEntry.create({
    userId: ownerId, kind: 'expense', description: 'Conta de energia', totalCents: 5000,
    categoryId: category._id, personId: person._id, entryDate: '2026-11-12', paymentMethod: 'pix',
  });
  await CashEntry.create({
    userId: otherId, kind: 'expense', description: 'Despesa alheia', totalCents: 10000,
    categoryId: otherCategory._id, personId: otherPerson._id, entryDate: '2026-11-12', paymentMethod: 'pix',
  });
  const receivable = await CashEntry.create({
    userId: ownerId, kind: 'sale', description: 'Venda a receber', totalCents: 8000,
    categoryId: category._id, personId: person._id, entryDate: '2026-11-12', firstDueDate: '2026-11-20',
  });
  await CashInstallment.create({
    userId: ownerId, entryId: receivable._id, number: 1, count: 1, amountCents: 8000, dueDate: '2026-11-20',
  });

  const history = await executarFerramenta('consultarHistoricoFinanceiro', {
    mes: 11, ano: 2026, origem: 'cartao',
  }, ownerId);
  assert.equal(history.cartao.length, 1);
  assert.equal(history.cartao[0].descricao, 'Compra do usuário');
  assert.equal(history.cartao[0].parcelaNoPeriodo.valorPago, 10);

  const accounts = await executarFerramenta('consultarContasFinanceiras', {
    mes: 11, ano: 2026,
  }, ownerId);
  assert.equal(accounts.resumo.spent, 50);
  assert.equal(accounts.resumo.totalReceivable, 80);
  assert.equal(accounts.saldoCaixa, -50);
  assert.deepEqual(new Set(accounts.lancamentos.map((item) => item.descricao)), new Set(['Conta de energia', 'Venda a receber']));

  const categories = await executarFerramenta('listarCategoriasFinanceiras', {}, ownerId);
  assert.deepEqual(categories, [{ nome: 'Alimentação', tipo: 'expense' }]);
  const budget = await executarFerramenta('consultarPlanilhaFinanceiraPessoa', {
    nomePessoa: 'Pessoa dona', mes: 11, ano: 2026,
  }, ownerId);
  assert.equal(budget.encontrada, true);
  assert.deepEqual(budget.linhas.map((row) => row.nome), ['Salário', 'Energia']);
  assert.equal(budget.linhas[0].valor, 5000);
  await assert.rejects(() => executarFerramenta('consultarPlanilhaFinanceiraPessoa', {
    nomePessoa: 'Pessoa dona', mes: 11, ano: 2026,
  }, otherId), /não encontrado/);
  const comparison = await executarFerramenta('consultarComparacaoFinanceira', {
    mes: 11, ano: 2026,
  }, ownerId);
  assert.equal(comparison.cartoes.atual, 30);
  assert.equal(comparison.cartoes.periodoAnterior, 0);
  assert.equal(comparison.despesasAvulsas.atual, 50);
  assert.equal(comparison.despesasAvulsas.periodoAnterior, 0);
  assert.ok(toolsDeclaration.some((tool) => tool.name === 'consultarComparacaoFinanceira'));
  assert.ok(toolsDeclaration.some((tool) => tool.name === 'consultarHistoricoFinanceiro'));
});

test('perguntas não autorizam escrita e pedidos explícitos habilitam as ferramentas de alteração', async () => {
  const account = await createTestAccount({ email: 'ai-write-authorization@example.invalid' });
  const api = createApiClient(baseUrl, account.cookie);
  await saveConfig(api, PROVIDERS[0]);
  let requestCount = 0;
  let offeredTools = [];
  mockProviderFetch(async (_url, options) => {
    requestCount += 1;
    const request = JSON.parse(options.body);
    offeredTools = request.tools.flatMap((tool) => tool.functionDeclarations.map((item) => item.name));
    if (requestCount === 1) {
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'cadastrarNovoCartao', args: {
              nome: 'Cartão não autorizado', limite: 1000, diaFechamento: 3, diaVencimento: 10,
            } } }],
          },
          finishReason: 'STOP',
        }],
      }), { status: 200 });
    }
    return providerResponse('gemini', 200, 'Não alterei nenhum dado sem autorização.');
  });

  const informational = await api('POST', '/assistant/chat', { message: 'Como faço para cadastrar um cartão?' });
  assert.equal(informational.status, 200, informational.text);
  assert.equal(requestCount, 2);
  assert.equal(offeredTools.includes('cadastrarNovoCartao'), false);
  assert.equal(await Card.countDocuments({ userId: account.user._id }), 1);
  assert.equal(await Card.exists({ userId: account.user._id, name: 'Cartão não autorizado' }), null);

  requestCount = 0;
  mockProviderFetch(async (_url, options) => {
    const request = JSON.parse(options.body);
    offeredTools = request.tools.flatMap((tool) => tool.functionDeclarations.map((item) => item.name));
    return providerResponse('gemini', 200, 'Informe os dados do cartão.');
  });
  const requested = await api('POST', '/assistant/chat', { message: 'Cadastre um cartão para mim.' });
  assert.equal(requested.status, 200, requested.text);
  assert.equal(offeredTools.includes('cadastrarNovoCartao'), true);

  const followUp = await api('POST', '/assistant/chat', {
    message: 'Cartão Azul, limite 1000, fecha dia 3 e vence dia 10.',
    history: [
      { role: 'user', text: 'Cadastre um cartão para mim.' },
      { role: 'assistant', text: 'Qual é o nome, o limite, o dia de fechamento e o vencimento?' },
    ],
  });
  assert.equal(followUp.status, 200, followUp.text);
  assert.equal(offeredTools.includes('cadastrarNovoCartao'), true);

  const declined = await api('POST', '/assistant/chat', {
    message: 'Não, deixa para lá.',
    history: [
      { role: 'user', text: 'Cadastre um cartão para mim.' },
      { role: 'assistant', text: 'Qual é o nome, o limite, o dia de fechamento e o vencimento?' },
    ],
  });
  assert.equal(declined.status, 200, declined.text);
  assert.equal(offeredTools.includes('cadastrarNovoCartao'), false);

  requestCount = 0;
  mockProviderFetch(async (_url, options) => {
    const request = JSON.parse(options.body);
    offeredTools = request.tools.flatMap((tool) => tool.functionDeclarations.map((item) => item.name));
    return providerResponse('gemini', 200, 'A movimentação está pronta para ser executada.');
  });
  const moveRequested = await api('POST', '/assistant/chat', {
    message: 'Migre a linha Moradia da planilha da Denize em 2026 para Despesas de veículos.',
  });
  assert.equal(moveRequested.status, 200, moveRequested.text);
  assert.equal(offeredTools.includes('moverLinhaPlanilha'), true);

  requestCount = 0;
  mockProviderFetch(async (_url, options) => {
    const request = JSON.parse(options.body);
    offeredTools = request.tools.flatMap((tool) => tool.functionDeclarations.map((item) => item.name));
    return providerResponse('gemini', 200, 'Movimentação confirmada.');
  });
  const moveConfirmed = await api('POST', '/assistant/chat', {
    message: 'Sim.',
    history: [
      { role: 'user', text: 'Migre a linha Moradia da planilha da Denize em 2026 para Despesas de veículos.' },
      { role: 'assistant', text: 'Posso confirmar essa movimentação para você?' },
    ],
  });
  assert.equal(moveConfirmed.status, 200, moveConfirmed.text);
  assert.equal(offeredTools.includes('moverLinhaPlanilha'), true);
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
