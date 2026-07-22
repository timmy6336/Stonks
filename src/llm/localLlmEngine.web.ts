/** Web/desktop stub for localLlmEngine.ts — see localModel.web.ts for why. */
export async function generateLocalInsight(_prompt: string): Promise<string> {
  throw new Error('The local on-device model is not available in the desktop app — use a cloud AI provider instead.');
}

export async function unloadLocalModel(): Promise<void> {
  // nothing was ever loaded on this platform
}
