/**
 * Web/desktop stub for localModel.ts. The on-device model relies on llama.rn, a native module with
 * no web implementation, so the desktop build can't run local inference at all — this file keeps
 * the same exported surface (so llmClient.ts and SettingsScreen don't need platform checks of their
 * own) while reporting the model as permanently unavailable.
 */
export const LOCAL_MODEL = {
  name: 'Qwen2.5 0.5B Instruct',
  fileName: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  url: '',
  approxSizeLabel: '~400 MB',
};

export function isModelDownloaded(): boolean {
  return false;
}

export function getModelPath(): string {
  throw new Error('The local on-device model is not available in the desktop app.');
}

export function deleteModel(): void {
  // nothing to delete — the model can never be downloaded on this platform
}

export type DownloadProgress = { fraction: number; totalBytes: number };

export async function downloadModel(_onProgress: (progress: DownloadProgress) => void, _signal?: AbortSignal): Promise<void> {
  throw new Error('The local on-device model is not available in the desktop app — use a cloud AI provider instead.');
}
