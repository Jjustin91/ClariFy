const TOKEN_STORAGE_KEY = 'clarify_sanctum_bearer_token';

/**
 * In-memory mirror of the active Sanctum bearer token for synchronous read access
 * after initial hydration from expo-secure-store.
 */
let memoryToken: string | null = null;

/**
 * Adapter interface for hardware-backed token storage (expo-secure-store in runtime,
 * or an inspected mock adapter in unit tests).
 */
export interface SecureTokenStorageAdapter {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

let customAdapter: SecureTokenStorageAdapter | null = null;

export function setSecureTokenStorageAdapterForTests(
  adapter: SecureTokenStorageAdapter | null
): void {
  customAdapter = adapter;
}

async function getDefaultSecureStoreAdapter(): Promise<SecureTokenStorageAdapter> {
  try {
    const SecureStore = await import('expo-secure-store');
    return {
      getItemAsync: async (key: string) => SecureStore.getItemAsync(key),
      setItemAsync: async (key: string, value: string) =>
        SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }),
      deleteItemAsync: async (key: string) => SecureStore.deleteItemAsync(key),
    };
  } catch {
    return {
      getItemAsync: async () => memoryToken,
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    };
  }
}

async function resolveAdapter(): Promise<SecureTokenStorageAdapter> {
  if (customAdapter) {
    return customAdapter;
  }
  return getDefaultSecureStoreAdapter();
}

/**
 * Synchronously returns the currently hydrated bearer token from memory.
 */
export function getCachedBearerToken(): string | null {
  return memoryToken;
}

/**
 * Reads the Sanctum bearer token from expo-secure-store and synchronizes the in-memory cache.
 */
export async function getSecureToken(): Promise<string | null> {
  try {
    const adapter = await resolveAdapter();
    const stored = await adapter.getItemAsync(TOKEN_STORAGE_KEY);
    const normalized =
      stored && stored.trim().length > 0 ? stored.trim() : null;
    memoryToken = normalized;
    return normalized;
  } catch {
    return memoryToken;
  }
}

/**
 * Saves the Sanctum bearer token exclusively to expo-secure-store (or clears it if null/empty).
 */
export async function setSecureToken(token: string | null): Promise<void> {
  const normalized = token && token.trim().length > 0 ? token.trim() : null;
  memoryToken = normalized;
  try {
    const adapter = await resolveAdapter();
    if (normalized) {
      await adapter.setItemAsync(TOKEN_STORAGE_KEY, normalized);
    } else {
      await adapter.deleteItemAsync(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Keep memoryToken updated even if keychain is unavailable on web/simulator
  }
}

/**
 * Deletes the Sanctum bearer token from expo-secure-store and clears the in-memory cache.
 */
export async function clearSecureToken(): Promise<void> {
  memoryToken = null;
  try {
    const adapter = await resolveAdapter();
    await adapter.deleteItemAsync(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore deletion errors if key does not exist
  }
}

export { TOKEN_STORAGE_KEY };
