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

function formatSanitizedError(error: unknown): string {
  const errObj = error instanceof Error ? error : null;
  const name =
    errObj?.name?.trim() ||
    (error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name.trim()
      : '') ||
    'Error';
  const rawMessage =
    errObj?.message ||
    (error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : typeof error === 'string'
        ? error
        : 'Unknown error');

  const sanitizedMessage = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/Expo(?:nent)?PushToken\[[^\]]+\]/gi, 'ExpoPushToken[[REDACTED]]')
    .replace(/(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n;,]+/gi, '$1: [REDACTED]')
    .replace(/https?:\/\/[^\s)'"`]+/gi, '[URL_REDACTED]')
    .replace(/([?&](?:token|access_token|auth|key|secret|password|jwt)=)[^&\s)'"`]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return `${name}: ${sanitizedMessage || 'Unknown error'}`;
}

async function getDefaultSecureStoreAdapter(): Promise<SecureTokenStorageAdapter> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store') as {
      getItemAsync: (key: string) => Promise<string | null>;
      setItemAsync: (
        key: string,
        value: string,
        options?: { keychainAccessible?: number }
      ) => Promise<void>;
      deleteItemAsync: (key: string) => Promise<void>;
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: number;
    };
    if (
      typeof SecureStore?.getItemAsync !== 'function' ||
      typeof SecureStore?.setItemAsync !== 'function' ||
      typeof SecureStore?.deleteItemAsync !== 'function'
    ) {
      throw new Error('expo-secure-store module API is unavailable');
    }
    return {
      getItemAsync: async (key: string) => SecureStore.getItemAsync(key),
      setItemAsync: async (key: string, value: string) =>
        SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }),
      deleteItemAsync: async (key: string) => SecureStore.deleteItemAsync(key),
    };
  } catch (error) {
    console.warn(
      `[secure-token] Failed to load expo-secure-store; falling back to in-memory storage (${formatSanitizedError(error)})`
    );
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
  } catch (error) {
    console.warn(
      `[secure-token] Failed to read token from secure storage (${formatSanitizedError(error)})`
    );
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
  } catch (error) {
    // Keep memoryToken updated even if keychain is unavailable on web/simulator
    console.warn(
      `[secure-token] Failed to persist token to secure storage (${formatSanitizedError(error)})`
    );
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
  } catch (error) {
    // Ignore deletion errors if key does not exist
    console.warn(
      `[secure-token] Failed to delete token from secure storage (${formatSanitizedError(error)})`
    );
  }
}

export { TOKEN_STORAGE_KEY };
