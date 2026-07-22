export type LLMProviderId = 'gemini' | 'groq' | 'openrouter' | 'mistral';

export type LLMProvider = {
  id: LLMProviderId;
  name: string;
  model: string;
  freeTierNote: string;
  apiKeyUrl: string;
  generate: (apiKey: string, prompt: string) => Promise<string>;
};

/** Shared caller for OpenAI-compatible chat completion endpoints (Groq, OpenRouter, Mistral all speak this format). */
async function chatCompletion(
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      // The trading prompt can ask for several actions per round; a low provider-side default
      // output limit was truncating responses mid-JSON before they finished. This is generous
      // enough for a summary plus a full batch of actions with short reasoning.
      max_tokens: 1024,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Request failed: HTTP ${res.status}`);
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('The model returned an empty response.');
  }
  return text;
}

async function generateGemini(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? res.statusText);
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }
  return text;
}

/**
 * Every provider here has a free tier that needs no credit card. Adding another provider later is just
 * one more entry in this array plus (if it's not already OpenAI-compatible) a small generate function.
 */
export const LLM_PROVIDERS: LLMProvider[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    model: 'gemini-2.0-flash',
    freeTierNote: 'Generous free daily quota directly from Google AI Studio — no credit card required.',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    generate: generateGemini,
  },
  {
    id: 'groq',
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    freeTierNote: 'Free tier with high rate limits and very fast inference (runs Llama 3.3); no credit card required.',
    apiKeyUrl: 'https://console.groq.com/keys',
    generate: (key, prompt) => chatCompletion('https://api.groq.com/openai/v1/chat/completions', key, 'llama-3.3-70b-versatile', prompt),
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    freeTierNote: 'Routes to several models that are entirely free to use (the ":free" model IDs); no credit card required.',
    apiKeyUrl: 'https://openrouter.ai/keys',
    generate: (key, prompt) =>
      chatCompletion('https://openrouter.ai/api/v1/chat/completions', key, 'meta-llama/llama-3.3-70b-instruct:free', prompt, {
        'HTTP-Referer': 'https://github.com/timmy6336/Stonks',
        'X-Title': 'Stonks',
      }),
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    model: 'mistral-small-latest',
    freeTierNote: 'Free "Experiment" tier with rate-limited access to Mistral\'s models; no credit card required.',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    generate: (key, prompt) => chatCompletion('https://api.mistral.ai/v1/chat/completions', key, 'mistral-small-latest', prompt),
  },
];

export function getProvider(id: LLMProviderId): LLMProvider {
  const provider = LLM_PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    throw new Error(`Unknown AI provider "${id}"`);
  }
  return provider;
}
