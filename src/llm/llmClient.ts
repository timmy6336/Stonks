import * as SecureStore from 'expo-secure-store';
import { getAppStateValue, setAppStateValue } from '../db/database';
import { LLM_PROVIDERS, getProvider, type LLMProviderId } from './providers';

const ACTIVE_PROVIDER_KEY = 'llm_active_provider';

function keyStoreKey(id: LLMProviderId): string {
  return `${id}_api_key`;
}

export async function saveProviderApiKey(id: LLMProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(keyStoreKey(id), key);
  const active = await getAppStateValue(ACTIVE_PROVIDER_KEY);
  if (!active) {
    await setAppStateValue(ACTIVE_PROVIDER_KEY, id); // first key saved becomes the default provider
  }
}

export async function getProviderApiKey(id: LLMProviderId): Promise<string | null> {
  return SecureStore.getItemAsync(keyStoreKey(id));
}

export async function clearProviderApiKey(id: LLMProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(keyStoreKey(id));
}

export async function hasProviderApiKey(id: LLMProviderId): Promise<boolean> {
  return (await getProviderApiKey(id)) !== null;
}

export async function hasAnyApiKey(): Promise<boolean> {
  const results = await Promise.all(LLM_PROVIDERS.map((p) => hasProviderApiKey(p.id)));
  return results.some(Boolean);
}

/** The provider used for AI insights: the user's chosen default, or the first provider with a saved key. */
export async function getActiveProviderId(): Promise<LLMProviderId | null> {
  const saved = (await getAppStateValue(ACTIVE_PROVIDER_KEY)) as LLMProviderId | null;
  if (saved && (await hasProviderApiKey(saved))) return saved;
  for (const p of LLM_PROVIDERS) {
    if (await hasProviderApiKey(p.id)) return p.id;
  }
  return null;
}

export async function setActiveProviderId(id: LLMProviderId): Promise<void> {
  await setAppStateValue(ACTIVE_PROVIDER_KEY, id);
}

/** Sends a prompt to the user's active AI provider (using their own API key) and returns the generated text. */
export async function generateInsight(prompt: string): Promise<string> {
  const activeId = await getActiveProviderId();
  if (!activeId) {
    throw new Error('No AI provider configured. Add a free API key in Settings first.');
  }
  const provider = getProvider(activeId);
  const apiKey = await getProviderApiKey(activeId);
  if (!apiKey) {
    throw new Error(`No API key saved for ${provider.name}.`);
  }
  try {
    return await provider.generate(apiKey, prompt);
  } catch (e) {
    throw new Error(`${provider.name} error: ${(e as Error).message}`);
  }
}
