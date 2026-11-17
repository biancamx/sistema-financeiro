import { AppError } from '../../../lib/errors.js';

export function toJsonSchema(schema = {}) {
  const typeMap = {
    OBJECT: 'object',
    STRING: 'string',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
  };
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') result.type = typeMap[value] ?? value.toLowerCase();
    else if (key === 'properties' && value && typeof value === 'object') {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, toJsonSchema(child)]),
      );
    } else if (key === 'items' && value && typeof value === 'object') result.items = toJsonSchema(value);
    else result[key] = value;
  }
  return result;
}

export function providerRequestError(status) {
  if (status === 401 || status === 403) {
    return new AppError(422, 'AI_KEY_REJECTED', 'O provedor recusou a chave de API. Confira a chave e tente novamente.');
  }
  if (status === 429) {
    return new AppError(429, 'AI_PROVIDER_LIMIT', 'O provedor informou que a cota ou o limite de requisições foi excedido.');
  }
  if (status === 400 || status === 404) {
    return new AppError(422, 'AI_MODEL_UNAVAILABLE', 'O provedor não aceitou o modelo selecionado para esta chave.');
  }
  return new AppError(502, 'AI_PROVIDER_ERROR', 'Não foi possível concluir a solicitação no provedor de IA.');
}

export async function postProviderJson(url, headers, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AppError(502, 'AI_PROVIDER_UNAVAILABLE', 'Não foi possível conectar ao provedor de IA.');
  }

  if (!response.ok) throw providerRequestError(response.status);
  try {
    return await response.json();
  } catch {
    throw new AppError(502, 'AI_PROVIDER_RESPONSE', 'O provedor de IA retornou uma resposta inválida.');
  }
}

export function responseText(output) {
  if (typeof output?.output_text === 'string') return output.output_text;
  return (output?.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}
