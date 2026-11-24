import { AppError, notFound } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { User } from '../../models/User.js';
import { getProvider, publicProviderList } from '../ai/providers/index.js';
import { decryptAiApiKey, encryptAiApiKey } from './ai-crypto.js';

function assertProviderModel(providerId, model) {
  const provider = getProvider(providerId);
  if (!provider || !provider.models.includes(model)) {
    throw new AppError(400, 'AI_PROVIDER_MODEL_INVALID', 'Selecione um provedor e modelo autorizados.');
  }
  return provider;
}

export async function getAiSettings(userId) {
  const user = await User.findById(userId)
    .select('+aiApiKeyEncrypted +aiDataConsentAt')
    .lean();
  if (!user) throw notFound('Usuário não encontrado.');

  const hasKey = Boolean(user.aiApiKeyEncrypted);
  return {
    configured: hasKey,
    provider: user.aiProvider ?? null,
    model: user.aiModel ?? null,
    last4: hasKey ? decryptAiApiKey(user.aiApiKeyEncrypted).slice(-4) : null,
    consentGiven: Boolean(user.aiDataConsentAt),
    providers: publicProviderList(),
  };
}

export async function saveAiSettings(userId, { provider: providerId, model, apiKey, consent }) {
  const provider = assertProviderModel(providerId, model);
  if (consent !== true) {
    throw new AppError(400, 'AI_CONSENT_REQUIRED', 'Confirme o envio de dados ao provedor antes de salvar a chave.');
  }

  const user = await User.findById(userId).select('+aiApiKeyEncrypted');
  if (!user) throw notFound('Usuário não encontrado.');
  const canKeepExistingKey = user.aiProvider === providerId && Boolean(user.aiApiKeyEncrypted);
  if (!apiKey && !canKeepExistingKey) {
    throw new AppError(400, 'AI_KEY_REQUIRED', 'Informe a chave de API para este provedor.');
  }
  const keyToValidate = apiKey || decryptAiApiKey(user.aiApiKeyEncrypted);
  await provider.adapter.test({ apiKey: keyToValidate, model });
  user.aiProvider = providerId;
  user.aiModel = model;
  if (apiKey) user.aiApiKeyEncrypted = encryptAiApiKey(apiKey);
  user.aiDataConsentAt = new Date();
  await user.save();
  const last4 = apiKey
    ? apiKey.slice(-4)
    : decryptAiApiKey(user.aiApiKeyEncrypted).slice(-4);

  return {
    configured: true,
    provider: providerId,
    model,
    last4,
    consentGiven: true,
    providers: publicProviderList(),
  };
}

export async function removeAiSettings(userId) {
  const user = await User.findById(userId);
  if (!user) throw notFound('Usuário não encontrado.');
  user.aiProvider = null;
  user.aiModel = null;
  user.aiApiKeyEncrypted = null;
  user.aiDataConsentAt = null;
  await user.save();
}

export async function setAiConsent(userId, consent) {
  const user = await User.findById(userId).select('+aiApiKeyEncrypted');
  if (!user) throw notFound('Usuário não encontrado.');
  if (consent && !user.aiApiKeyEncrypted) {
    throw new AppError(409, 'AI_NOT_CONFIGURED', 'Salve uma chave de IA antes de ativar o consentimento.');
  }
  user.aiDataConsentAt = consent ? new Date() : null;
  await user.save();
  return { consentGiven: Boolean(user.aiDataConsentAt) };
}

export async function testAiProvider({ provider: providerId, model, apiKey, userId }) {
  const provider = assertProviderModel(providerId, model);
  let keyToValidate = apiKey;
  if (!keyToValidate && userId) {
    const user = await User.findById(userId).select('+aiApiKeyEncrypted').lean();
    if (user?.aiProvider === providerId && user.aiApiKeyEncrypted) {
      keyToValidate = decryptAiApiKey(user.aiApiKeyEncrypted);
    }
  }
  if (!keyToValidate) {
    throw new AppError(400, 'AI_KEY_REQUIRED', 'Informe uma chave de API para testar este provedor.');
  }
  await provider.adapter.test({ apiKey: keyToValidate, model });
}

function getFallbackConfig() {
  const { aiFallbackProvider: providerId, aiFallbackModel: model, aiFallbackApiKey: apiKey } = env;
  if (!providerId && !model && !apiKey) return null;
  const provider = getProvider(providerId);
  if (!provider || !provider.models.includes(model) || !apiKey) {
    throw new Error('A configuração de fallback da IA contém provedor, modelo ou chave inválidos.');
  }
  return { providerId, provider, model, apiKey };
}

export async function completeWithFallback(config, request, primaryError) {
  if (!['AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_LIMIT', 'AI_PROVIDER_TIMEOUT'].includes(primaryError?.code)) {
    throw primaryError;
  }
  let fallback;
  try {
    fallback = getFallbackConfig();
  } catch {
    logger.error({
      provider: config.providerId,
      fallbackProvider: env.aiFallbackProvider || 'invalid',
    }, 'Configuração de fallback da IA inválida');
    throw primaryError;
  }
  if (!fallback || fallback.providerId === config.providerId) throw primaryError;

  logger.warn({
    provider: config.providerId,
    model: config.model,
    fallbackProvider: fallback.providerId,
    fallbackModel: fallback.model,
    errorCode: primaryError.code,
  }, 'Tentando fallback configurado para o provedor de IA');
  try {
    await fallback.provider.adapter.test({ apiKey: fallback.apiKey, model: fallback.model });
    const result = await fallback.provider.adapter.complete({
      ...request,
      apiKey: fallback.apiKey,
      model: fallback.model,
    });
    logger.info({
      provider: config.providerId,
      fallbackProvider: fallback.providerId,
      fallbackModel: fallback.model,
    }, 'Fallback de IA concluído');
    return result;
  } catch (error) {
    logger.error({
      fallbackProvider: fallback.providerId,
      fallbackModel: fallback.model,
      ...(typeof error?.status === 'number' && { status: error.status }),
      ...(typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) && { code: error.code }),
      ...(typeof error?.name === 'string' && { errorName: error.name }),
    }, 'Falha no fallback configurado para IA');
    throw primaryError;
  }
}

export async function requireUserAiConfig(userId) {
  const user = await User.findById(userId)
    .select('+aiApiKeyEncrypted +aiDataConsentAt')
    .lean();
  if (!user?.aiApiKeyEncrypted || !user.aiProvider || !user.aiModel) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'Configure sua chave de IA na aba Configurações para usar o assistente ou analisar PDFs.');
  }
  if (!user.aiDataConsentAt) {
    throw new AppError(403, 'AI_CONSENT_REQUIRED', 'Confirme o envio de dados ao provedor na aba Configurações para usar a IA.');
  }
  const provider = assertProviderModel(user.aiProvider, user.aiModel);
  return {
    providerId: user.aiProvider,
    model: user.aiModel,
    apiKey: decryptAiApiKey(user.aiApiKeyEncrypted),
    adapter: provider.adapter,
  };
}
