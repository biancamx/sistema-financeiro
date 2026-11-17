import { postProviderJson, responseText, toJsonSchema } from './shared.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';

function toInput(messages, document) {
  return messages.flatMap((message, index) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return message.toolCalls.map((call) => ({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      }));
    }
    if (message.role === 'tool') {
      return [{
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content,
      }];
    }

    const content = [];
    if (message.content) content.push({ type: 'input_text', text: message.content });
    if (message.image) {
      content.push({
        type: 'input_image',
        image_url: `data:${message.image.mimeType};base64,${message.image.base64}`,
      });
    }
    if (document && index === messages.length - 1) {
      content.push({
        type: 'input_file',
        filename: 'document.pdf',
        file_data: `data:application/pdf;base64,${document.base64}`,
      });
    }
    return [{ role: message.role, content }];
  });
}

function toTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toJsonSchema(tool.parameters),
    strict: false,
  }));
}

export const openaiProvider = {
  async test({ apiKey, model }) {
    await postProviderJson(ENDPOINT, { Authorization: `Bearer ${apiKey}` }, {
      model,
      input: 'Responda somente OK.',
      max_output_tokens: 8,
      store: false,
    });
  },

  async complete({ apiKey, model, systemInstruction, messages, tools = [], document, json = false }) {
    const result = await postProviderJson(ENDPOINT, { Authorization: `Bearer ${apiKey}` }, {
      model,
      instructions: systemInstruction,
      input: toInput(messages, document),
      ...(tools.length ? { tools: toTools(tools) } : {}),
      ...(json ? { text: { format: { type: 'json_object' } } } : {}),
      max_output_tokens: 12_000,
      store: false,
    });
    const toolCalls = (result.output ?? [])
      .filter((item) => item.type === 'function_call')
      .map((item) => {
        let args = {};
        try {
          args = JSON.parse(item.arguments);
        } catch {
          throw new Error('O provedor retornou argumentos inválidos para uma ferramenta.');
        }
        return { id: item.call_id, name: item.name, arguments: args };
      });
    return { text: responseText(result), toolCalls };
  },
};
