import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  apiClient,
  loginApi,
  mapClientErrorToApiError,
  mapHttpErrorToApiError,
  onSessionExpired,
  parseRetryAfterSeconds,
  registerApi,
  requestPasswordOtpApi,
  resetPasswordApi,
  sendChannelChatMessageApi,
  updateProfileApi,
  UPLOAD_REQUEST_TIMEOUT_MS,
  verifyPasswordOtpApi,
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
import {
  prepareFormDataForUpload,
  prepareUploadFileForFormData,
  sanitizeUploadErrorDetail,
  setUploadFileSystemAdapterForTests,
  type UploadFileSystemAdapter,
  type UploadFileSystemFile,
} from './upload-file.ts';
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
    const capturedBody: { formData: FormData | null } = { formData: null };

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody.formData = init?.body as FormData;
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
    assert.equal(capturedBody.formData?.get('_method'), 'PATCH');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('password reset OTP API helpers send snake_case JSON without Bearer auth and extract 429 retry_after JSON', async () => {
  const originalFetch = globalThis.fetch;
  const requests: {
    url: string;
    method?: string;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  let sessionExpiredTriggered = false;
  const unsub = onSessionExpired(() => {
    sessionExpiredTriggered = true;
  });

  try {
    await setSecureToken('existing-user-token');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      const parsedBody =
        typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ url, method: init?.method, headers, body: parsedBody });

      if (url.endsWith('/auth/password/request-otp')) {
        return createMockFetchResponse({
          status: 200,
          body: {
            message: 'Code sent.',
            masked_phone: '+63917***4567',
            expires_in_seconds: 600,
            resend_cooldown_seconds: 60,
          },
        });
      }
      if (url.endsWith('/auth/password/verify-otp')) {
        return createMockFetchResponse({
          status: 200,
          body: {
            message: 'Verified.',
            reset_token: 'rst-tok-123',
            expires_in_seconds: 600,
          },
        });
      }
      return createMockFetchResponse({
        status: 200,
        body: { message: 'Password updated.' },
      });
    }) as typeof fetch;

    const reqRes = await requestPasswordOtpApi(' 2023300001 ');
    assert.equal(reqRes.masked_phone, '+63917***4567');
    assert.equal(reqRes.resend_cooldown_seconds, 60);

    const verRes = await verifyPasswordOtpApi('2023300001', ' 482910 ');
    assert.equal(verRes.reset_token, 'rst-tok-123');

    const resetRes = await resetPasswordApi({
      institutional_id: '2023300001',
      reset_token: 'rst-tok-123',
      password: 'NewPassword123',
      password_confirmation: 'NewPassword123',
    });
    assert.equal(resetRes.message, 'Password updated.');

    assert.equal(requests.length, 3);
    for (const req of requests) {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.Authorization, undefined);
      assert.equal(req.headers.Accept, 'application/json');
    }
    assert.deepEqual(requests[0].body, { institutional_id: '2023300001' });
    assert.deepEqual(requests[1].body, {
      institutional_id: '2023300001',
      otp: '482910',
    });
    assert.deepEqual(requests[2].body, {
      institutional_id: '2023300001',
      reset_token: 'rst-tok-123',
      password: 'NewPassword123',
      password_confirmation: 'NewPassword123',
    });

    // 429 JSON retry_after without Retry-After header
    const err429Json = mapHttpErrorToApiError({
      status: 429,
      json: {
        message: 'Please wait before requesting another code.',
        retry_after: 47,
      },
      retryAfterHeader: null,
      endpoint: '/auth/password/request-otp',
    });
    assert.equal(err429Json.status, 429);
    assert.equal(err429Json.retryAfter, 47);
    assert.equal(err429Json.message, 'Too many attempts, try again in 47 seconds');

    // 401 on skipAuth endpoint must NOT clear SecureStore or trigger session-expired
    globalThis.fetch = (async () =>
      createMockFetchResponse({
        status: 401,
        body: { message: 'Unauthorized.' },
      })) as typeof fetch;

    await assert.rejects(async () => {
      await requestPasswordOtpApi('2023300001');
    });
    assert.equal(sessionExpiredTriggered, false);
    assert.equal(getCachedBearerToken(), 'existing-user-token');
  } finally {
    unsub();
    globalThis.fetch = originalFetch;
    await clearSecureToken();
  }
});

test('registerApi posts trimmed first_name and last_name without Bearer auth', async () => {
  const originalFetch = globalThis.fetch;
  const capturedRequests: {
    url: string;
    method?: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }[] = [];

  try {
    await setSecureToken('existing-user-token');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequests.push({
        url: String(input),
        method: init?.method,
        headers: (init?.headers || {}) as Record<string, string>,
        body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
      });
      return createMockFetchResponse({
        status: 201,
        body: {
          message: 'Account registered successfully!',
          data: {
            id: 42,
            institutional_id: '2026123456',
            name: 'Juan Dela Cruz',
            first_name: 'Juan',
            last_name: 'Dela Cruz',
            email: 'juan@ustp.edu.ph',
            role: 'student',
            verification_status: 'pending',
          },
        },
      });
    }) as typeof fetch;

    const res = await registerApi({
      first_name: '  Juan  ',
      last_name: '  Dela Cruz  ',
      institutional_id: '2026123456',
      email: 'juan@ustp.edu.ph',
      contact_number: '+639171234567',
      password: 'Password123',
      role: 'student',
      department: 'CITC',
      section: 'IT3R2',
    });

    assert.equal(res.data.name, 'Juan Dela Cruz');
    assert.equal(res.data.first_name, 'Juan');
    assert.equal(res.data.last_name, 'Dela Cruz');
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.Authorization, undefined);
    assert.equal(req.body.first_name, 'Juan');
    assert.equal(req.body.last_name, 'Dela Cruz');
    assert.equal('name' in req.body, false);
  } finally {
    globalThis.fetch = originalFetch;
    await clearSecureToken();
  }
});

test('mapClientErrorToApiError preserves non-secret cause details and maps failure types accurately', () => {
  // 1. Timeout on upload vs non-upload
  const abortErr = new Error('The operation was aborted.');
  abortErr.name = 'AbortError';

  const nonUploadTimeout = mapClientErrorToApiError(abortErr, { isUpload: false });
  assert.equal(nonUploadTimeout.status, 0);
  assert.equal(nonUploadTimeout.code, 'timeout');
  assert.equal(nonUploadTimeout.causeName, 'AbortError');
  assert.equal(nonUploadTimeout.causeMessage, 'The operation was aborted.');
  assert.equal(
    nonUploadTimeout.message,
    'Request timed out. Please check your connection and try again.'
  );

  const uploadTimeout = mapClientErrorToApiError(abortErr, { isUpload: true });
  assert.equal(uploadTimeout.code, 'timeout');
  assert.equal(uploadTimeout.causeName, 'AbortError');
  assert.match(uploadTimeout.message, /Upload timed out/i);

  // 2. Unreadable file error
  const fileErr = new Error('ENOENT: no such file or directory');
  fileErr.name = 'FileNotFoundException';
  const mappedFile = mapClientErrorToApiError(fileErr, { isUpload: true });
  assert.equal(mappedFile.code, 'file_unreadable');
  assert.equal(mappedFile.causeName, 'FileNotFoundException');
  assert.match(mappedFile.message, /Upload failed: could not read file/i);

  // 3. Expo SDK 58 FormData serialization failure
  const formDataErr = new Error('Unsupported FormDataPart implementation');
  const mappedFormData = mapClientErrorToApiError(formDataErr, { isUpload: true });
  assert.equal(mappedFormData.code, 'upload_failed');
  assert.equal(mappedFormData.causeMessage, 'Unsupported FormDataPart implementation');
  assert.match(mappedFormData.message, /could not prepare attachment data/i);

  // 4. Genuine offline / DNS / connection abort failures
  const dnsErr = new Error('fetch failed: Unable to resolve host "api.ustpclarify.tech"');
  dnsErr.name = 'FetchError';
  const mappedOfflineUpload = mapClientErrorToApiError(dnsErr, { isUpload: true });
  assert.equal(mappedOfflineUpload.code, 'offline');
  assert.equal(mappedOfflineUpload.causeName, 'FetchError');
  assert.match(mappedOfflineUpload.message, /no network connection/i);

  const connAbortErr = new Error('Software caused connection abort');
  connAbortErr.name = 'SocketException';
  const mappedConnAbort = mapClientErrorToApiError(connAbortErr, { isUpload: true });
  assert.equal(mappedConnAbort.code, 'offline');

  // 5. Unexpected upload error surfaces concise sanitized reason and redacts tokens
  const tlsErr = new Error(
    'fetch failed: SSL handshake failed Authorization: Bearer super-secret-token-123'
  );
  tlsErr.name = 'FetchError';
  const mappedTls = mapClientErrorToApiError(tlsErr, { isUpload: true });
  assert.equal(mappedTls.code, 'upload_failed');
  assert.ok(mappedTls.causeMessage?.includes('[REDACTED]'));
  assert.equal(mappedTls.causeMessage?.includes('super-secret-token-123'), false);
  assert.equal(mappedTls.message.includes('super-secret-token-123'), false);
  assert.match(mappedTls.message, /^Upload failed: SSL handshake failed/i);

  // 6. Direct sanitizer test
  assert.equal(
    sanitizeUploadErrorDetail('Bearer abc.def.ghi failed'),
    'Bearer [REDACTED] failed'
  );

  // 7. HTTP 413 mapping
  const err413 = mapHttpErrorToApiError({ status: 413, json: {} });
  assert.equal(err413.status, 413);
  assert.match(err413.message, /too large/i);
});

function createMockFsAdapter(options: {
  files: Record<string, { exists: boolean; bytes?: Uint8Array; readError?: Error; copyError?: Error }>;
  deletedUris?: string[];
  copiedUris?: string[];
}): UploadFileSystemAdapter {
  const store = new Map<string, { exists: boolean; bytes?: Uint8Array; readError?: Error; copyError?: Error }>(
    Object.entries(options.files)
  );
  let seq = 0;

  const makeHandle = (uri: string): UploadFileSystemFile => ({
    get uri() {
      return uri;
    },
    get exists() {
      return Boolean(store.get(uri)?.exists);
    },
    get size() {
      return store.get(uri)?.bytes?.byteLength ?? 0;
    },
    async copy(destination) {
      const entry = store.get(uri);
      if (entry?.copyError) {
        throw entry.copyError;
      }
      if (!entry?.exists || !entry.bytes) {
        throw new Error('Source file missing during copy');
      }
      store.set(destination.uri, {
        exists: true,
        bytes: new Uint8Array(entry.bytes),
      });
      options.copiedUris?.push(destination.uri);
    },
    async bytes() {
      const entry = store.get(uri);
      if (entry?.readError) {
        throw entry.readError;
      }
      if (!entry?.exists || !entry.bytes) {
        throw new Error('Cannot read file bytes');
      }
      return entry.bytes;
    },
    delete() {
      store.delete(uri);
      options.deletedUris?.push(uri);
    },
  });

  return {
    createFile(uri: string) {
      return makeHandle(uri);
    },
    createCacheUploadFile(fileName: string) {
      seq += 1;
      const cacheUri = `file:///cache/clarify-uploads/${seq}_${fileName}`;
      return makeHandle(cacheUri);
    },
  };
}

test('prepareUploadFileForFormData verifies file:// directly, copies content:// to cache, and rejects unreadable/empty files', async () => {
  const deletedUris: string[] = [];
  const copiedUris: string[] = [];

  try {
    setUploadFileSystemAdapterForTests(
      createMockFsAdapter({
        files: {
          'file:///cache/ImagePicker/photo.jpg': {
            exists: true,
            bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
          },
          'content://com.android.providers.downloads/document/42': {
            exists: true,
            bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          },
          'file:///cache/empty.txt': {
            exists: true,
            bytes: new Uint8Array([]),
          },
          'file:///cache/unreadable_direct.m4a': {
            exists: true,
            bytes: new Uint8Array([1, 2, 3, 4]),
            readError: new Error('EACCES: direct read blocked'),
          },
          'file:///cache/broken.pdf': {
            exists: true,
            bytes: new Uint8Array([9, 8, 7]),
            readError: new Error('EIO: disk read failed'),
            copyError: new Error('EIO: copy failed'),
          },
        },
        deletedUris,
        copiedUris,
      })
    );

    // 1. Readable file:// URI uploads directly without cache copy
    const direct = await prepareUploadFileForFormData({
      uri: 'file:///cache/ImagePicker/photo.jpg',
      name: 'whiteboard.jpg',
      type: 'image/jpeg',
    });
    assert.equal(direct.copiedToCache, false);
    assert.equal(direct.uri, 'file:///cache/ImagePicker/photo.jpg');
    assert.equal(direct.name, 'whiteboard.jpg');
    assert.equal(direct.type, 'image/jpeg');
    assert.equal(direct.size, 4);
    const directPart = direct.toFormDataPart();
    assert.equal(directPart.name, 'whiteboard.jpg');
    assert.equal(directPart.type, 'image/jpeg');
    assert.deepEqual(await directPart.bytes(), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    // 2. content:// URI is copied to cache file:// and cleaned up on cleanup()
    const fromContent = await prepareUploadFileForFormData({
      uri: 'content://com.android.providers.downloads/document/42',
      name: 'Lab4_Report.pdf',
      type: 'application/pdf',
    });
    assert.equal(fromContent.copiedToCache, true);
    assert.ok(fromContent.uri.startsWith('file:///cache/clarify-uploads/'));
    assert.equal(fromContent.size, 4);
    fromContent.cleanup();
    assert.ok(deletedUris.includes(fromContent.uri));

    // 3. file:// whose direct read fails falls back to cache copy
    const fallback = await prepareUploadFileForFormData({
      uri: 'file:///cache/unreadable_direct.m4a',
      name: 'Voice_Note_0m05s.m4a',
      type: 'audio/mp4',
    });
    assert.equal(fallback.copiedToCache, true);
    assert.ok(fallback.uri.startsWith('file:///cache/clarify-uploads/'));
    assert.equal(fallback.size, 4);
    fallback.cleanup();

    // 4. Missing file URI
    await assert.rejects(
      async () => {
        await prepareUploadFileForFormData({
          uri: '   ',
          name: 'missing.jpg',
          type: 'image/jpeg',
        });
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 0);
        assert.equal(apiErr.code, 'file_unreadable');
        assert.match(apiErr.message, /could not read file/i);
        return true;
      }
    );

    // 5. Non-existent file
    await assert.rejects(
      async () => {
        await prepareUploadFileForFormData({
          uri: 'file:///cache/does_not_exist.jpg',
          name: 'gone.jpg',
          type: 'image/jpeg',
        });
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 0);
        assert.equal(apiErr.code, 'file_unreadable');
        assert.match(apiErr.message, /file not found/i);
        return true;
      }
    );

    // 6. Empty file
    await assert.rejects(
      async () => {
        await prepareUploadFileForFormData({
          uri: 'file:///cache/empty.txt',
          name: 'empty.txt',
          type: 'text/plain',
        });
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 0);
        assert.equal(apiErr.code, 'file_unreadable');
        assert.match(apiErr.message, /empty/i);
        return true;
      }
    );

    // 7. Read + fallback copy failure preserves native error detail
    await assert.rejects(
      async () => {
        await prepareUploadFileForFormData({
          uri: 'file:///cache/broken.pdf',
          name: 'broken.pdf',
          type: 'application/pdf',
        });
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 0);
        assert.equal(apiErr.code, 'file_unreadable');
        assert.equal(apiErr.causeMessage, 'EIO: copy failed');
        return true;
      }
    );
  } finally {
    setUploadFileSystemAdapterForTests(null);
  }
});

test('apiClient stages native FormData uploads, preserves Accept/Authorization without Content-Type, and cleans up temp cache', async () => {
  const originalFetch = globalThis.fetch;
  const deletedUris: string[] = [];

  class FakeReactNativeFormData extends FormData {
    _parts: [string, unknown][] = [];

    override append(name: string, value: unknown): void {
      this._parts.push([String(name), value]);
    }

    override *entries(): FormDataIterator<[string, FormDataEntryValue]> {
      for (const [k, v] of this._parts) {
        yield [k, v as FormDataEntryValue];
      }
    }
  }

  try {
    await setSecureToken('upload-bearer-token');
    setUploadFileSystemAdapterForTests(
      createMockFsAdapter({
        files: {
          'content://media/external/images/99': {
            exists: true,
            bytes: new Uint8Array([10, 20, 30, 40, 50]),
          },
        },
        deletedUris,
      })
    );

    // Verify prepareFormDataForUpload rebuilds RN FormData parts cleanly
    const rnForm = new FakeReactNativeFormData();
    rnForm.append('content', 'Check this photo');
    rnForm.append('attachment', {
      uri: 'content://media/external/images/99',
      name: 'campus.jpg',
      type: 'image/jpeg',
    });

    const prepared = await prepareFormDataForUpload(rnForm);
    assert.equal(prepared.hasFileAttachment, true);
    assert.equal(prepared.formData.get('content'), 'Check this photo');
    const attachmentEntry = prepared.formData.get('attachment');
    assert.ok(attachmentEntry instanceof Blob);
    assert.equal(attachmentEntry.size, 5);
    prepared.cleanup();
    assert.equal(deletedUris.length, 1);

    // End-to-end apiClient upload with FakeReactNativeFormData
    let capturedHeaders: Record<string, string> = {};
    const capturedBody: { formData: FormData | null } = { formData: null };

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody.formData = init?.body as FormData;
      return createMockFetchResponse({
        status: 201,
        body: {
          data: {
            id: 77,
            channel_id: 2,
            content: 'Check this photo',
            created_at: '2026-11-25T00:00:00Z',
            author: { id: 1, name: 'Student', role: 'student' },
          },
        },
      });
    }) as typeof fetch;

    const uploadForm = new FakeReactNativeFormData();
    uploadForm.append('content', 'Check this photo');
    uploadForm.append('attachment', {
      uri: 'content://media/external/images/99',
      name: 'campus.jpg',
      type: 'image/jpeg',
    });

    await apiClient('/channels/2/messages', {
      method: 'POST',
      body: uploadForm,
      timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
    });

    assert.equal(capturedHeaders.Accept, 'application/json');
    assert.equal(capturedHeaders.Authorization, 'Bearer upload-bearer-token');
    assert.equal(capturedHeaders['Content-Type'], undefined);
    assert.ok(capturedBody.formData instanceof FormData);
    assert.equal(deletedUris.length, 2);

    // Offline fetch rejection on upload preserves cause and still cleans up temp cache copy
    globalThis.fetch = (async () => {
      const err = new Error('fetch failed: Unable to resolve host "api.ustpclarify.tech"');
      err.name = 'FetchError';
      throw err;
    }) as typeof fetch;

    const offlineForm = new FakeReactNativeFormData();
    offlineForm.append('content', 'Offline photo');
    offlineForm.append('attachment', {
      uri: 'content://media/external/images/99',
      name: 'campus.jpg',
      type: 'image/jpeg',
    });

    await assert.rejects(
      async () => {
        await apiClient('/channels/2/messages', {
          method: 'POST',
          body: offlineForm,
          timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
        });
      },
      (err: unknown) => {
        const apiErr = err as ApiError;
        assert.equal(apiErr.status, 0);
        assert.equal(apiErr.code, 'offline');
        assert.equal(apiErr.causeName, 'FetchError');
        assert.match(apiErr.message, /no network connection/i);
        return true;
      }
    );
    assert.equal(deletedUris.length, 3);

    // Restore 201 mock and ensure sendChannelChatMessageApi with Blob attachment returns 201
    globalThis.fetch = (async () =>
      createMockFetchResponse({
        status: 201,
        body: {
          data: {
            id: 77,
            channel_id: 2,
            content: 'Voice caption',
            created_at: '2026-11-25T00:00:00Z',
            author: { id: 1, name: 'Student', role: 'student' },
          },
        },
      })) as typeof fetch;

    const msgRes = await sendChannelChatMessageApi(
      2,
      'Voice caption',
      'temp-1',
      new Blob(['audio'], { type: 'audio/mp4' })
    );
    assert.equal(msgRes.data.id, 77);
  } finally {
    setUploadFileSystemAdapterForTests(null);
    globalThis.fetch = originalFetch;
    await clearSecureToken();
  }
});

test('no non-test file under clarify-mobile/src contains dynamic import() with a quoted specifier', () => {
  const srcRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const dynamicImportPattern = /import\(\s*['"`]/;
  const violations: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
        continue;
      }
      const contents = fs.readFileSync(fullPath, 'utf8');
      if (dynamicImportPattern.test(contents)) {
        violations.push(path.relative(srcRoot, fullPath));
      }
    }
  };

  walk(srcRoot);
  assert.deepEqual(
    violations,
    [],
    `Dynamic import() is forbidden in clarify-mobile/src (breaks Metro release bundles): ${violations.join(', ')}`
  );
});

