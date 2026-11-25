import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-gemini-provider';
process.env.AI_KEY_SECRET = 'b'.repeat(64);

const { geminiProvider } = await import('../src/modules/ai/providers/gemini.js');

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;

async function captureGeminiRequest({ model, document }) {
  let requestBody;
  const timeoutValues = [];
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{}' }], role: 'model' }, finishReason: 'STOP' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  AbortSignal.timeout = (milliseconds) => {
    timeoutValues.push(milliseconds);
    return originalTimeout.call(AbortSignal, milliseconds);
  };

  try {
    await geminiProvider.complete({
      apiKey: 'test-key',
      model,
      messages: [{ role: 'user', content: 'Analise este documento.' }],
      document,
      json: true,
    });
    return { requestBody, timeoutValues };
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
}

test('Gemini Flash não impõe timeout local a documentos e desativa thinking', async () => {
  const { requestBody, timeoutValues } = await captureGeminiRequest({
    model: 'gemini-2.5-flash',
    document: { base64: 'JVBERi0=', mimeType: 'application/pdf' },
  });

  assert.deepEqual(timeoutValues, []);
  assert.equal(requestBody.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(requestBody.generationConfig.responseMimeType, 'application/json');
});

test('chamadas sem documento mantêm o timeout normal e não alteram modelos Flash recentes', async () => {
  const { requestBody, timeoutValues } = await captureGeminiRequest({ model: 'gemini-3.5-flash-lite' });

  assert.deepEqual(timeoutValues, [30_000]);
  assert.equal(requestBody.generationConfig.thinkingConfig, undefined);
});

test('timeout de documento Gemini não dispara novas tentativas longas', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new DOMException('The operation was aborted.', 'AbortError');
  };
  AbortSignal.timeout = () => originalTimeout.call(AbortSignal, 90_000);

  try {
    await assert.rejects(
      () => geminiProvider.complete({
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Analise este documento.' }],
        document: { base64: 'JVBERi0=', mimeType: 'application/pdf' },
      }),
      { code: 'AI_PROVIDER_TIMEOUT' },
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test('PDF tenta Gemini 3.5 Flash-Lite após indisponibilidade 503 do modelo selecionado', async () => {
  const requestedModels = [];
  globalThis.fetch = async (url) => {
    requestedModels.push(String(url).match(/models\/([^:]+)/)?.[1]);
    if (requestedModels.length <= 3) {
      return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"records":[]}' }], role: 'model' }, finishReason: 'STOP' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await geminiProvider.complete({
      apiKey: 'test-key',
      model: 'gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'Analise este PDF.' }],
      document: { base64: 'JVBERi0=', mimeType: 'application/pdf' },
      json: true,
    });

    assert.equal(result.text, '{"records":[]}');
    assert.deepEqual(requestedModels, [
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('falha 503 sem documento não troca silenciosamente o modelo selecionado', async () => {
  const requestedModels = [];
  globalThis.fetch = async (url) => {
    requestedModels.push(String(url).match(/models\/([^:]+)/)?.[1]);
    return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await assert.rejects(
      () => geminiProvider.complete({
        apiKey: 'test-key',
        model: 'gemini-3.1-flash-lite',
        messages: [{ role: 'user', content: 'Olá.' }],
      }),
      { code: 'AI_PROVIDER_UNAVAILABLE' },
    );
    assert.deepEqual(requestedModels, [
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
