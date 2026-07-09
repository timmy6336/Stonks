import { initLlama, type LlamaContext } from 'llama.rn';
import { getModelPath, isModelDownloaded } from './localModel';

const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|EOT|>',
  '<|END_OF_TURN_TOKEN|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

let contextPromise: Promise<LlamaContext> | null = null;

async function getContext(): Promise<LlamaContext> {
  if (!isModelDownloaded()) {
    throw new Error('The local model is not downloaded yet. Download it in Settings first.');
  }
  if (!contextPromise) {
    contextPromise = initLlama({
      model: getModelPath(),
      n_ctx: 2048,
      n_gpu_layers: 0, // CPU-only for reliability across devices
    }).catch((e) => {
      contextPromise = null; // let the next call retry instead of caching a failed load
      throw e;
    });
  }
  return contextPromise;
}

/** Runs a prompt through the on-device model. Nothing here ever leaves the phone. */
export async function generateLocalInsight(prompt: string): Promise<string> {
  const context = await getContext();
  const result = await context.completion({
    messages: [{ role: 'user', content: prompt }],
    n_predict: 300,
    stop: STOP_WORDS,
  });
  const text = result?.text?.trim();
  if (!text) {
    throw new Error('The local model returned an empty response.');
  }
  return text;
}

/** Frees the loaded model from memory. Call this when the model is deleted or no longer active. */
export async function unloadLocalModel(): Promise<void> {
  if (!contextPromise) return;
  const ctx = await contextPromise.catch(() => null);
  contextPromise = null;
  await ctx?.release();
}
