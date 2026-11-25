import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../../../lib/errors.js';
import { providerRequestError, withProviderRetries } from './shared.js';

const API_VERSION = 'v1';
const REQUEST_TIMEOUT_MS = 30_000;

function geminiRequestError(error, model) {
  const status = error?.status ?? error?.response?.status;
  const timedOut = ['GoogleGenerativeAIAbortError', 'AbortError', 'TimeoutError'].includes(error?.name)
    || (typeof error?.message === 'string'
      && (/Request aborted when fetching /.test(error.message) || /timed out|timeout/i.test(error.message)));
  const networkFailure = !status
    && typeof error?.message === 'string'
    && error.message.startsWith('[GoogleGenerativeAI Error]: Error fetching from ');

  if (timedOut) {
    return new AppError(504, 'AI_PROVIDER_TIMEOUT', 'O provedor demorou demais para responder. Tente novamente.');
  }
  if (networkFailure) {
    return new AppError(502, 'AI_PROVIDER_UNAVAILABLE', 'Não foi possível conectar ao provedor de IA.');
  }
  return providerRequestError(status);
}

function toGeminiContents(messages, document) {
  return messages.map((message, index) => {
    const parts = [];
    if (message.role === 'assistant' && message.providerParts) {
      parts.push(...message.providerParts);
    } else if (message.role === 'assistant') {
      if (message.content) parts.push({ text: message.content });
      parts.push(...(message.toolCalls ?? []).map(({ name, arguments: args }) => ({
        functionCall: { name, args },
      })));
    } else if (message.role === 'tool') {
      let result;
      try {
        result = JSON.parse(message.content);
      } catch {
        result = { result: message.content };
      }
      parts.push({ functionResponse: { name: message.name, response: { result } } });
    } else if (message.content) {
      parts.push({ text: message.content });
    }

    if (message.image) {
      parts.push({ inlineData: { data: message.image.base64, mimeType: message.image.mimeType } });
    }
    if (document && index === messages.length - 1) {
      parts.push({ inlineData: { data: document.base64, mimeType: document.mimeType } });
    }
    return { role: message.role === 'assistant' ? 'model' : 'user', parts };
  });
}

export const geminiProvider = {
  async test({ apiKey, model }) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      await withProviderRetries('gemini', model, () => genAI
        .getGenerativeModel(
          { model, generationConfig: { maxOutputTokens: 16 } },
          { apiVersion: API_VERSION, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        )
        .generateContent('Responda somente OK.'));
    } catch (error) {
      throw geminiRequestError(error, model);
    }
  },

  async complete({ apiKey, model, systemInstruction, messages, tools = [], document, generationConfig = {}, json = false }) {
    let response;
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      response = (await withProviderRetries('gemini', model, () => {
        const effectiveGenerationConfig = {
          ...generationConfig,
          ...(json ? { responseMimeType: 'application/json' } : {}),
          ...(model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        };
        const generativeModel = genAI.getGenerativeModel({
          model,
          systemInstruction,
          tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
          generationConfig: effectiveGenerationConfig,
        }, {
          apiVersion: API_VERSION,
          ...(!document && { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        });
        return generativeModel.generateContent({
          contents: toGeminiContents(messages, document),
        });
      }, { retryOnTimeout: !document })).response;
    } catch (error) {
      throw geminiRequestError(error, model);
    }

    const toolCalls = response.functionCalls?.() ?? [];
    if (toolCalls.length) {
      return {
        text: '',
        providerParts: response.candidates?.[0]?.content?.parts ?? [],
        toolCalls: toolCalls.map((call, index) => ({
          id: `${call.name}-${index}`,
          name: call.name,
          arguments: call.args ?? {},
        })),
      };
    }
    return { text: response.text(), toolCalls: [] };
  },
};
