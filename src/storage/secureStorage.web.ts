/**
 * Web/desktop fallback for secureStorage.ts. There's no OS keychain to reach for in a browser or
 * an Electron renderer, so this keeps values in localStorage instead — scoped to this app's own
 * origin, not readable by other sites, and on the desktop build never leaves the user's machine.
 * It's less protected than a real keychain (e.g. no OS-level encryption at rest), so this is a
 * deliberate trade-off for the desktop build rather than an oversight.
 */
const PREFIX = 'stonks_secure_';

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  window.localStorage.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  window.localStorage.removeItem(PREFIX + key);
}
