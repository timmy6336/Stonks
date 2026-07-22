import * as SecureStore from 'expo-secure-store';

/**
 * Thin wrapper around expo-secure-store so callers don't import it directly — expo-secure-store
 * has no real implementation on web (it's iOS/Android only), so this file has a `.web.ts` sibling
 * that swaps in a different backing store there. Metro/webpack picks whichever file matches the
 * target platform automatically.
 */
export async function getItemAsync(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
