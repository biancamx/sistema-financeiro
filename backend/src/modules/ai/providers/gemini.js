import { GoogleGenerativeAI } from '@google/generative-ai';
import { providerRequestError } from './shared.js';

function toGeminiContents(messages, document) {
  return messages.map((message, index) => {
    const parts = [];
    if (message.content) parts.push({ text: message.content });

    if (message.role === 'assistant' && message.toolCalls?.length) {
      parts.push(...message.toolCalls.map(({ name, arguments: args }) => ({
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
      throw providerRequestError(error.status ?? error.response?.status);
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
      throw providerRequestError(error.status ?? error.response?.status);
    }

    const toolCalls = response.functionCalls?.() ?? [];
    if (toolCalls.length) {
      return {
        text: '',
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
