import { AppError, notFound } from '../../lib/errors.js';
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

export async function testAiProvider({ provider: providerId, model, apiKey }) {
  const provider = assertProviderModel(providerId, model);
  await provider.adapter.test({ apiKey, model });
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
    model: user.aiModel,
    apiKey: decryptAiApiKey(user.aiApiKeyEncrypted),
    adapter: provider.adapter,
  };
}
