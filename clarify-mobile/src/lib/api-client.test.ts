import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apiClient,
  loginApi,
  mapHttpErrorToApiError,
  onSessionExpired,
  parseRetryAfterSeconds,
  updateProfileApi,
} from './api-client.ts';
import { getFieldValidationError } from './domain-logic.ts';
import {
  clearSecureToken,
  getCachedBearerToken,
  getSecureToken,
  setSecureToken,
  setSecureTokenStorageAdapterForTests,
  TOKEN_STORAGE_KEY,
} from './secure-token.ts';
import type { ApiError } from '../types/api.ts';

function createMockFetchResponse(options: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  const headerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(options.headers || {})) {
    headerMap.set(k.toLowerCase(), v);
  }
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    } as Headers,
    json: async () => options.body ?? {},
  } as Response;
}

test('secure-token stores, reads, and deletes token exclusively through the SecureStore adapter', async () => {
  const backingStore = new Map<string, string>();
  setSecureTokenStorageAdapterForTests({
    getItemAsync: async (key) => backingStore.get(key) ?? null,
    setItemAsync: async (key, value) => {
      backingStore.set(key, value);
    },
    deleteItemAsync: async (key) => {
      backingStore.delete(key);
    },
  });

  await clearSecureToken();
  assert.equal(getCachedBearerToken(), null);
  assert.equal(await getSecureToken(), null);

  await setSecureToken('  sanctum-token-abc123  ');
  assert.equal(getCachedBearerToken(), 'sanctum-token-abc123');
  assert.equal(backingStore.get(TOKEN_STORAGE_KEY), 'sanctum-token-abc123');
  assert.equal(await getSecureToken(), 'sanctum-token-abc123');

  await clearSecureToken();
  assert.equal(getCachedBearerToken(), null);
  assert.equal(backingStore.has(TOKEN_STORAGE_KEY), false);
});

test('apiClient attaches Accept: application/json and Authorization: Bearer <token>, and loginApi saves token', async () => {
  const originalFetch = globalThis.fetch;
  const capturedRequests: { url: string; headers: Record<string, string>; method?: string }[] = [];

  try {
    await clearSecureToken();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      capturedRequests.push({ url, headers, method: init?.method });

      if (url.endsWith('/auth/login')) {
        return createMockFetchResponse({
          status: 200,
          body: {
            token: 'token-from-login-999',
            data: {
              id: 21,
              institutional_id: '2020202020',
              name: 'Kobeni Higashiyama',
              email: 'kobeni@ustp.edu.ph',
              role: 'student',
              verification_status: 'approved',
            },
          },
        });
      }

      return createMockFetchResponse({
        status: 200,
        body: {
          data: {
            id: 21,
            institutional_id: '2020202020',
            name: 'Kobeni Higashiyama',
            email: 'kobeni@ustp.edu.ph',
            role: 'student',
            verification_status: 'approved',
          },
        },
      });
    }) as typeof fetch;

    const loginRes = await loginApi(' 2020202020 ', 'secret123');
    assert.equal(loginRes.token, 'token-from-login-999');
    assert.equal(loginRes.user.name, 'Kobeni Higashiyama');
    assert.equal(getCachedBearerToken(), 'token-from-login-999');

    // Subsequent authenticated request must carry Accept: application/json and Authorization: Bearer
    await apiClient('/auth/me');
    assert.equal(capturedRequests.length, 2);
    assert.equal(capturedRequests[1].headers.Accept, 'application/json');
    assert.equal(
      capturedRequests[1].headers.Authorization,
      'Bearer token-from-login-999'
    );
  } finally {
    globalThis.fetch = originalFetch;
    await clearSecureToken();
  }
});

test('apiClient 401 on authenticated endpoint clears token from SecureStore and triggers onSessionExpired callback', async () => {
  const originalFetch = globalThis.fetch;
  let expiredNotice: string | null = null;
  const unsubscribe = onSessionExpired((msg) => {
    expiredNotice = msg;
  });

  try {
    await setSecureToken('expired-sanctum-token');
    assert.equal(getCachedBearerToken(), 'expired-sanctum-token');

    globalThis.fetch = (async () =>
      createMockFetchResponse({
        status: 401,
        body: { message: 'Unauthenticated.' },
      })) as typeof fetch;

    await assert.rejects(
      async () => {
        await apiClient('/channels');
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 401);
        assert.equal(
          apiErr.message,
          'Your session has expired. Please sign in again.'
        );
        return true;
      }
    );

    assert.equal(getCachedBearerToken(), null);
    assert.equal(
      expiredNotice,
      'Your session has expired. Please sign in again.'
    );
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
  }
});

test('mapHttpErrorToApiError maps 403 pending verification, 404, 409, 422 field errors, and 429 Retry-After', () => {
  // 403 Pending Verification
  const err403Pending = mapHttpErrorToApiError({
    status: 403,
    json: {
      message: 'Your account is pending IT Administrator verification.',
      verification_status: 'pending',
    },
    endpoint: '/auth/login',
  });
  assert.equal(err403Pending.status, 403);
  assert.equal(err403Pending.verification_status, 'pending');
  assert.equal(
    err403Pending.message,
    'Your account is pending IT Administrator verification.'
  );

  // 404 Not Found
  const err404 = mapHttpErrorToApiError({
    status: 404,
    json: {},
  });
  assert.equal(err404.status, 404);
  assert.equal(err404.message, 'The requested resource was not found.');

  // 409 Conflict (already handled join request)
  const err409 = mapHttpErrorToApiError({
    status: 409,
    json: { message: 'Membership request was already approved by another admin.' },
  });
  assert.equal(err409.status, 409);
  assert.equal(
    err409.message,
    'Membership request was already approved by another admin.'
  );

  // 422 Validation Errors
  const err422 = mapHttpErrorToApiError({
    status: 422,
    json: {
      message: 'The given data was invalid.',
      errors: {
        institutional_id: ['The institutional id field is required.'],
        password: ['The password must be at least 8 characters.'],
      },
    },
  });
  assert.equal(err422.status, 422);
  assert.equal(
    getFieldValidationError(err422.errors, 'institutional_id'),
    'The institutional id field is required.'
  );
  assert.equal(
    getFieldValidationError(err422.errors, 'password'),
    'The password must be at least 8 characters.'
  );

  // 429 Rate Limited with Retry-After header
  assert.equal(parseRetryAfterSeconds('42'), 42);
  assert.equal(parseRetryAfterSeconds(null), 60);

  const err429 = mapHttpErrorToApiError({
    status: 429,
    json: { message: 'Too Many Attempts.' },
    retryAfterHeader: '35',
  });
  assert.equal(err429.status, 429);
  assert.equal(err429.retryAfter, 35);
  assert.equal(
    err429.message,
    'Too many attempts, try again in 35 seconds'
  );
});

test('apiClient handles request timeout and network failure with status 0 ApiError, and updateProfileApi spoofs _method=PATCH', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. Timeout via AbortController
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await apiClient('/channels', { timeoutMs: 25 });
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 0);
        assert.equal(
          apiErr.message,
          'Request timed out. Please check your connection and try again.'
        );
        return true;
      }
    );

    // 2. Multipart FormData _method=PATCH spoofing without forcing Content-Type: application/json
    let capturedHeaders: Record<string, string> = {};
    let capturedFormData: FormData | null = null;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedFormData = init?.body as FormData;
      return createMockFetchResponse({
        status: 200,
        body: {
          data: {
            id: 21,
            institutional_id: '2020202020',
            name: 'Kobeni Updated',
            email: 'kobeni@ustp.edu.ph',
            role: 'student',
            verification_status: 'approved',
          },
        },
      });
    }) as typeof fetch;

    const form = new FormData();
    form.append('name', 'Kobeni Updated');
    await updateProfileApi(form);

    assert.equal(capturedHeaders.Accept, 'application/json');
    assert.equal(capturedHeaders['Content-Type'], undefined);
    assert.equal(capturedFormData?.get('_method'), 'PATCH');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
