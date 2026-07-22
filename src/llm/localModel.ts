import { Directory, File, Paths } from 'expo-file-system';

/**
 * Small instruct model used for fully on-device AI insights — no API key, no network calls
 * once downloaded. Chosen for its small download size; swap this out for a bigger/better GGUF
 * later if quality matters more than download size.
 */
export const LOCAL_MODEL = {
  name: 'Qwen2.5 0.5B Instruct',
  fileName: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf?download=true',
  approxSizeLabel: '~400 MB',
};

function getModelsDir(): Directory {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

function getModelFile(): File {
  return new File(getModelsDir(), LOCAL_MODEL.fileName);
}

export function isModelDownloaded(): boolean {
  return getModelFile().exists;
}

/** Local file path (file://...) llama.rn can load directly. */
export function getModelPath(): string {
  return getModelFile().uri;
}

export function deleteModel(): void {
  const file = getModelFile();
  if (file.exists) {
    file.delete();
  }
}

export type DownloadProgress = { fraction: number; totalBytes: number };

/** Downloads the local model to app storage, reporting progress as it streams in. */
export async function downloadModel(onProgress: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  const destination = new File(getModelsDir(), LOCAL_MODEL.fileName);
  await File.downloadFileAsync(LOCAL_MODEL.url, destination, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) {
        onProgress({ fraction: bytesWritten / totalBytes, totalBytes });
      }
    },
  });
}
