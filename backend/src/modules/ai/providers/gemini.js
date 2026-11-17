import { GoogleGenerativeAI } from '@google/generative-ai';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { providerRequestError } from './shared.js';

function geminiRequestError(error, model) {
  const status = error?.status ?? error?.response?.status;
  const networkFailure = !status
    && typeof error?.message === 'string'
    && error.message.startsWith('[GoogleGenerativeAI Error]: Error fetching from ');

  logger.error({
    provider: 'gemini',
    model,
    failureKind: status ? 'http' : networkFailure ? 'network' : 'sdk',
    ...(status && { status }),
    ...(typeof error?.name === 'string' && { errorName: error.name }),
    ...(typeof error?.cause?.code === 'string' && { causeCode: error.cause.code }),
  }, 'Falha na solicitação ao provedor Gemini');

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
      await genAI.getGenerativeModel({ model, generationConfig: { maxOutputTokens: 16 } })
        .generateContent('Responda somente OK.');
    } catch (error) {
      throw geminiRequestError(error, model);
    }
  },

  async complete({ apiKey, model, systemInstruction, messages, tools = [], document, generationConfig = {}, json = false }) {
    let response;
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const generativeModel = genAI.getGenerativeModel({
        model,
        systemInstruction,
        tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
        generationConfig: {
          ...generationConfig,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      });
      response = (await generativeModel.generateContent({
        contents: toGeminiContents(messages, document),
      })).response;
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
