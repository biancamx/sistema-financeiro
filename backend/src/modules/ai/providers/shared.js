import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

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
  if (status === 408) {
    return new AppError(504, 'AI_PROVIDER_TIMEOUT', 'O provedor demorou demais para responder. Tente novamente.');
  }
  if (status >= 500) {
    return new AppError(502, 'AI_PROVIDER_UNAVAILABLE', 'O provedor de IA está indisponível no momento. Tente novamente mais tarde.');
  }
  return new AppError(502, 'AI_PROVIDER_ERROR', 'O provedor de IA não conseguiu concluir a resposta. Confira a chave, o modelo e a cota em Configurações.');
}

export async function withProviderRetries(provider, model, request, { retryOnTimeout = true } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const status = error?.status ?? error?.response?.status;
      const timedOut = ['AbortError', 'TimeoutError', 'GoogleGenerativeAIAbortError'].includes(error?.name)
        || (typeof error?.message === 'string'
          && (/Request aborted when fetching /.test(error.message) || /timed out|timeout/i.test(error.message)));
      const networkFailure = error?.code === 'AI_PROVIDER_UNAVAILABLE'
        || (typeof error?.message === 'string'
          && error.message.startsWith('[GoogleGenerativeAI Error]: Error fetching from '));
      const retryable = RETRYABLE_STATUSES.has(status) || (networkFailure && (retryOnTimeout || !timedOut));
      if (!retryable || attempt === MAX_ATTEMPTS) {
        logger.error({
          provider,
          model,
          failureKind: status ? 'http' : ['AbortError', 'TimeoutError', 'GoogleGenerativeAIAbortError'].includes(error?.name) ? 'timeout' : 'request',
          ...(status && { status }),
          ...(typeof error?.name === 'string' && { errorName: error.name }),
          ...(typeof error?.cause?.code === 'string' && { causeCode: error.cause.code }),
          ...(typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) && { code: error.code }),
        }, 'Falha na solicitação ao provedor de IA');
        throw error;
      }
      logger.warn({ provider, model, status, attempt, nextAttempt: attempt + 1 }, 'Nova tentativa para solicitação temporária de IA');
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))));
    }
  }
  throw new Error('A solicitação ao provedor de IA terminou sem resultado.');
}

export async function postProviderJson(provider, model, url, headers, body) {
  return withProviderRetries(provider, model, async () => {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (['AbortError', 'TimeoutError'].includes(error?.name)) {
        throw new AppError(504, 'AI_PROVIDER_TIMEOUT', 'O provedor demorou demais para responder. Tente novamente.');
      }
      throw new AppError(502, 'AI_PROVIDER_UNAVAILABLE', 'Não foi possível conectar ao provedor de IA.');
    }

    if (!response.ok) throw providerRequestError(response.status);
    try {
      return await response.json();
    } catch {
      throw new AppError(502, 'AI_PROVIDER_RESPONSE', 'O provedor de IA retornou uma resposta inválida.');
    }
  });
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
