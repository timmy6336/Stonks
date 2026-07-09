import * as SecureStore from 'expo-secure-store';

const API_KEY_STORE_KEY = 'gemini_api_key';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function saveGeminiApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(API_KEY_STORE_KEY, key);
}

export async function getGeminiApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_STORE_KEY);
}

export async function clearGeminiApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY_STORE_KEY);
}

export async function hasGeminiApiKey(): Promise<boolean> {
  return (await getGeminiApiKey()) !== null;
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

/** Sends a prompt to the user's own Gemini API key and returns the generated text. */
export async function generateInsight(prompt: string): Promise<string> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key saved. Add a free key from Google AI Studio in Settings first.');
  }

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  const json: GeminiResponse = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini API error: ${json.error?.message ?? res.statusText}`);
  }

  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }
  return text;
}
