import { postProviderJson, toJsonSchema } from './shared.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const HEADERS = { 'anthropic-version': '2023-06-01' };

function appendMessage(messages, role, content) {
  const previous = messages.at(-1);
  if (previous?.role === role) previous.content.push(...content);
  else messages.push({ role, content });
}

function toMessages(input, document) {
  const messages = [];
  for (let index = 0; index < input.length; index += 1) {
    const message = input[index];
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      content.push(...message.toolCalls.map((call) => ({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.arguments,
      })));
      appendMessage(messages, 'assistant', content);
    } else if (message.role === 'tool') {
      appendMessage(messages, 'user', [{
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      }]);
    } else {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      if (message.image) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: message.image.mimeType,
            data: message.image.base64,
          },
        });
      }
      if (document && index === input.length - 1) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: document.mimeType, data: document.base64 },
        });
      }
      appendMessage(messages, message.role, content);
    }
  }
  return messages;
}

export const anthropicProvider = {
  async test({ apiKey, model }) {
    await postProviderJson(ENDPOINT, { ...HEADERS, 'x-api-key': apiKey }, {
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Responda somente OK.' }],
    });
  },

  async complete({ apiKey, model, systemInstruction, messages, tools = [], document }) {
    const result = await postProviderJson(ENDPOINT, { ...HEADERS, 'x-api-key': apiKey }, {
      model,
      max_tokens: 12_000,
      system: systemInstruction,
      messages: toMessages(messages, document),
      ...(tools.length ? {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: toJsonSchema(tool.parameters),
        })),
      } : {}),
    });
    return {
      text: (result.content ?? [])
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join(''),
      toolCalls: (result.content ?? [])
        .filter((item) => item.type === 'tool_use')
        .map((item) => ({ id: item.id, name: item.name, arguments: item.input })),
    };
  },
};
