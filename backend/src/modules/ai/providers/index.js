import { anthropicProvider } from './anthropic.js';
import { geminiProvider } from './gemini.js';
import { openaiProvider } from './openai.js';

export const aiProviders = {
  gemini: {
    label: 'Google Gemini',
    hint: 'Crie a chave no Google AI Studio. A disponibilidade de modelos pode variar por projeto.',
    models: [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite',
      'gemini-4-hydrogen',
      'gemini-4-argon',
      'gemini-4-carbon',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ],
    adapter: geminiProvider,
  },
  openai: {
    label: 'OpenAI',
    hint: 'Crie a chave em platform.openai.com.',
    models: ['gpt-4o-mini', 'gpt-4o'],
    adapter: openaiProvider,
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    hint: 'Crie a chave em console.anthropic.com.',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-5'],
    adapter: anthropicProvider,
  },
};

export function getProvider(providerId) {
  return aiProviders[providerId] ?? null;
}

export function publicProviderList() {
  return Object.fromEntries(Object.entries(aiProviders).map(([id, provider]) => [
    id,
    { label: provider.label, hint: provider.hint, models: provider.models },
  ]));
}
