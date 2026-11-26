import type { ApiError } from '../types/api.ts';
import type { NativeUploadFile } from './domain-logic.ts';

/**
 * WinterCG-compatible FormData file part accepted by Expo SDK 58's default `expo/fetch`
 * (`convertFormDataAsync` reads `name`, `type`, and `await part.bytes()`), while retaining
 * `uri` for compatibility with React Native's legacy XHR-backed `FormData` if opted in.
 */
export interface ExpoUploadFormDataPart {
  uri: string;
  name: string;
  type: string;
  size: number;
  bytes: () => Promise<Uint8Array>;
}

/**
 * Minimal file abstraction backed by Expo SDK 58's `expo-file-system` `File` class
 * (or an injected in-memory mock in Node unit tests).
 */
export interface UploadFileSystemFile {
  readonly uri: string;
  readonly exists: boolean;
  readonly size: number;
  copy(
    destination: UploadFileSystemFile,
    options?: { overwrite?: boolean }
  ): Promise<void>;
  bytes(): Promise<Uint8Array>;
  delete?: () => void;
}

export interface UploadFileSystemAdapter {
  createFile(uri: string): UploadFileSystemFile;
  createCacheUploadFile(fileName: string): UploadFileSystemFile;
}

export interface PreparedUploadFile {
  uri: string;
  name: string;
  type: string;
  size: number;
  copiedToCache: boolean;
  bytes: Uint8Array;
  cleanup: () => void;
  toFormDataPart: () => ExpoUploadFormDataPart;
}

let customFileSystemAdapter: UploadFileSystemAdapter | null = null;

/**
 * Injects a custom file-system adapter for unit tests (pass `null` to restore default).
 */
export function setUploadFileSystemAdapterForTests(
  adapter: UploadFileSystemAdapter | null
): void {
  customFileSystemAdapter = adapter;
}

/**
 * Strips potentially sensitive values (bearer tokens, authorization headers, cookies)
 * and caps length so error details are safe to attach to `ApiError` and display in UI.
 */
export function sanitizeUploadErrorDetail(
  rawMessage: string | null | undefined,
  maxLength = 160
): string | undefined {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return undefined;
  }
  const cleaned = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n;,]+/gi, '$1: [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return undefined;
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function createPreflightApiError(params: {
  message: string;
  causeName?: string;
  causeMessage?: string;
}): ApiError {
  return {
    status: 0,
    code: 'file_unreadable',
    message: params.message,
    causeName: params.causeName || 'UploadPreflightError',
    ...(params.causeMessage
      ? { causeMessage: sanitizeUploadErrorDetail(params.causeMessage) }
      : {}),
  };
}

function sanitizeCacheFileName(rawName: string): string {
  const trimmed = (rawName || '').trim();
  const base = trimmed.split(/[\\/]/).pop() || 'upload.bin';
  const safe = base.replace(/[^\w.\-()]+/g, '_').replace(/^\.+/, '');
  return safe.length > 0 ? safe.slice(-100) : 'upload.bin';
}

function normalizeDisplayFileName(rawName: string | undefined): string {
  const trimmed = (rawName || '').trim();
  const base = trimmed.split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\r\n\0"]/g, '').trim();
  return cleaned || 'attachment.bin';
}

function normalizeUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

/**
 * Type guard identifying a React Native `{ uri, name, type }` file descriptor appended to FormData.
 */
export function isNativeUploadFilePart(
  value: unknown
): value is NativeUploadFile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.uri === 'string' &&
    candidate.uri.trim().length > 0 &&
    typeof candidate.bytes !== 'function'
  );
}

async function resolveDefaultFileSystemAdapter(): Promise<UploadFileSystemAdapter | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system');

    if (Platform.OS === 'web') {
      return null;
    }

    const { Directory, File, Paths } = FileSystem;
    if (!File || !Directory || !Paths) {
      return null;
    }

    return {
      createFile(uri: string): UploadFileSystemFile {
        const instance = new File(uri);
        return {
          get uri() {
            return instance.uri;
          },
          get exists() {
            return instance.exists;
          },
          get size() {
            return instance.size;
          },
          copy: async (destination, options) => {
            const destNative = new File(destination.uri);
            await instance.copy(destNative, options);
          },
          bytes: async () => instance.bytes(),
          delete: () => {
            if (instance.exists) {
              instance.delete();
            }
          },
        };
      },
      createCacheUploadFile(fileName: string): UploadFileSystemFile {
        const uploadDir = new Directory(Paths.cache, 'clarify-uploads');
        if (!uploadDir.exists) {
          uploadDir.create({ idempotent: true, intermediates: true });
        }
        const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${sanitizeCacheFileName(fileName)}`;
        const target = new File(uploadDir, uniqueName);
        return {
          get uri() {
            return target.uri;
          },
          get exists() {
            return target.exists;
          },
          get size() {
            return target.size;
          },
          copy: async (destination, options) => {
            const destNative = new File(destination.uri);
            await target.copy(destNative, options);
          },
          bytes: async () => target.bytes(),
          delete: () => {
            if (target.exists) {
              target.delete();
            }
          },
        };
      },
    };
  } catch (error) {
    const errObj = error instanceof Error ? error : null;
    const errName = errObj?.name?.trim() || 'Error';
    const rawMsg =
      errObj?.message || (typeof error === 'string' ? error : 'Unknown error');
    const safeMsg =
      sanitizeUploadErrorDetail(
        rawMsg
          .replace(/https?:\/\/[^\s)'"`]+/gi, '[URL_REDACTED]')
          .replace(
            /([?&](?:token|access_token|auth|key|secret|password|jwt)=)[^&\s)'"`]+/gi,
            '$1[REDACTED]'
          )
      ) || 'Unknown error';
    console.warn(
      `[upload-file] Failed to load expo-file-system adapter (${errName}: ${safeMsg})`
    );
    return null;
  }
}

async function resolveFileSystemAdapter(): Promise<UploadFileSystemAdapter | null> {
  if (customFileSystemAdapter) {
    return customFileSystemAdapter;
  }
  return resolveDefaultFileSystemAdapter();
}

/**
 * Pre-flight verification and staging for a native upload file using Expo SDK 58's
 * `expo-file-system` (`File`, `Directory`, `Paths`) API:
 * 1. Confirms the URI is present and the file exists.
 * 2. Copies non-`file://` URIs (such as `content://`) — or `file://` URIs that cannot be
 *    read directly — into the app cache directory (`Paths.cache/clarify-uploads/...`).
 * 3. Reads and verifies non-empty bytes so Expo SDK 58's `expo/fetch` (`convertFormDataAsync`)
 *    can serialize the multipart part cleanly without throwing `Unsupported FormDataPart implementation`.
 */
export async function prepareUploadFileForFormData(
  file: NativeUploadFile
): Promise<PreparedUploadFile> {
  const trimmedUri = typeof file?.uri === 'string' ? file.uri.trim() : '';
  const safeName = normalizeDisplayFileName(file?.name);
  const safeType =
    typeof file?.type === 'string' && file.type.trim().length > 0
      ? file.type.trim()
      : 'application/octet-stream';

  if (!trimmedUri) {
    throw createPreflightApiError({
      message: 'Upload failed: could not read file (missing file path).',
      causeMessage: 'Upload file URI is empty.',
    });
  }

  const adapter = await resolveFileSystemAdapter();
  if (!adapter) {
    throw createPreflightApiError({
      message: 'Upload failed: file system is unavailable on this device.',
      causeMessage: 'expo-file-system adapter unavailable.',
    });
  }

  let sourceFile: UploadFileSystemFile;
  try {
    sourceFile = adapter.createFile(trimmedUri);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    throw createPreflightApiError({
      message: 'Upload failed: could not read file.',
      causeName: e.name,
      causeMessage: e.message,
    });
  }

  let sourceExists = false;
  try {
    sourceExists = Boolean(sourceFile.exists);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    throw createPreflightApiError({
      message: 'Upload failed: could not read file.',
      causeName: e.name,
      causeMessage: e.message,
    });
  }

  if (!sourceExists) {
    throw createPreflightApiError({
      message:
        'Upload failed: could not read file (file not found). Please re-select the file and try again.',
      causeMessage: `File does not exist at URI scheme ${trimmedUri.split(':')[0] || 'unknown'}.`,
    });
  }

  let targetFile: UploadFileSystemFile = sourceFile;
  let copiedToCache = false;
  let cachedFileToCleanup: UploadFileSystemFile | null = null;

  const cleanup = () => {
    if (!cachedFileToCleanup) return;
    try {
      cachedFileToCleanup.delete?.();
    } catch {
      // Non-fatal: cache cleanup failure must never override upload outcome
    } finally {
      cachedFileToCleanup = null;
    }
  };

  const copySourceToCache = async (): Promise<UploadFileSystemFile> => {
    const dest = adapter.createCacheUploadFile(safeName);
    await sourceFile.copy(dest, { overwrite: true });
    if (!dest.exists) {
      throw new Error('Copied cache file does not exist after copy.');
    }
    copiedToCache = true;
    cachedFileToCleanup = dest;
    return dest;
  };

  const isFileUri = /^file:\/\//i.test(trimmedUri);
  if (!isFileUri) {
    try {
      targetFile = await copySourceToCache();
    } catch (err) {
      cleanup();
      const e = err instanceof Error ? err : new Error(String(err));
      throw createPreflightApiError({
        message: 'Upload failed: could not read file.',
        causeName: e.name,
        causeMessage: e.message,
      });
    }
  }

  let fileBytes: Uint8Array;
  try {
    fileBytes = normalizeUint8Array(await targetFile.bytes());
  } catch (readErr) {
    if (!copiedToCache) {
      // Fallback: if direct read on a file:// path failed, copy to app cache and retry read
      try {
        targetFile = await copySourceToCache();
        fileBytes = normalizeUint8Array(await targetFile.bytes());
      } catch (retryErr) {
        cleanup();
        const e =
          retryErr instanceof Error ? retryErr : new Error(String(retryErr));
        throw createPreflightApiError({
          message: 'Upload failed: could not read file.',
          causeName: e.name,
          causeMessage: e.message,
        });
      }
    } else {
      cleanup();
      const e =
        readErr instanceof Error ? readErr : new Error(String(readErr));
      throw createPreflightApiError({
        message: 'Upload failed: could not read file.',
        causeName: e.name,
        causeMessage: e.message,
      });
    }
  }

  if (fileBytes.byteLength <= 0) {
    cleanup();
    throw createPreflightApiError({
      message: 'Upload failed: selected file is empty.',
      causeMessage: 'Read 0 bytes from upload file.',
    });
  }

  const resolvedUri = targetFile.uri || trimmedUri;
  const resolvedSize = fileBytes.byteLength;

  return {
    uri: resolvedUri,
    name: safeName,
    type: safeType,
    size: resolvedSize,
    copiedToCache,
    bytes: fileBytes,
    cleanup,
    toFormDataPart: (): ExpoUploadFormDataPart => ({
      uri: resolvedUri,
      name: safeName,
      type: safeType,
      size: resolvedSize,
      bytes: async () => fileBytes,
    }),
  };
}

type FormDataWithInternals = FormData & {
  _parts?: [string, unknown][];
};

function readFormDataEntries(formData: FormData): [string, unknown][] {
  if (typeof formData.entries === 'function') {
    return Array.from(formData.entries() as Iterable<[string, unknown]>);
  }
  const internal = formData as FormDataWithInternals;
  if (Array.isArray(internal._parts)) {
    return [...internal._parts];
  }
  return [];
}

function isReactNativeFormData(formData: FormData): boolean {
  return Array.isArray((formData as FormDataWithInternals)._parts);
}

/**
 * Inspects a `FormData` payload prior to `fetch()`:
 * - Detects whether it contains any file attachment (`hasFileAttachment`).
 * - Runs SDK 58 `expo-file-system` pre-flight on every `{ uri, name, type }` native file
 *   part and rebuilds the `FormData` using `expo/fetch`-compatible file parts (`bytes()`),
 *   so Expo SDK 58's default `fetch` uploads them cleanly on Android & iOS.
 * - Returns a `cleanup()` callback to delete any temporary cache copies after the upload completes.
 */
export async function prepareFormDataForUpload(formData: FormData): Promise<{
  formData: FormData;
  hasFileAttachment: boolean;
  cleanup: () => void;
}> {
  const entries = readFormDataEntries(formData);
  let hasFileAttachment = false;
  let hasNativeUriPart = false;

  for (const [, value] of entries) {
    if (isNativeUploadFilePart(value)) {
      hasFileAttachment = true;
      hasNativeUriPart = true;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      ((typeof Blob !== 'undefined' && value instanceof Blob) ||
        'bytes' in value)
    ) {
      hasFileAttachment = true;
    }
  }

  if (!hasNativeUriPart) {
    return {
      formData,
      hasFileAttachment,
      cleanup: () => {},
    };
  }

  const cleanups: (() => void)[] = [];
  const runAllCleanups = () => {
    for (const fn of cleanups) {
      fn();
    }
    cleanups.length = 0;
  };

  try {
    const nextEntries: [string, unknown][] = [];

    for (const [key, value] of entries) {
      if (isNativeUploadFilePart(value)) {
        const prepared = await prepareUploadFileForFormData(value);
        cleanups.push(prepared.cleanup);
        nextEntries.push([key, prepared]);
      } else {
        nextEntries.push([key, value]);
      }
    }

    const rebuilt = new FormData();
    const useNativePartObject = isReactNativeFormData(rebuilt);

    for (const [key, value] of nextEntries) {
      if (
        value &&
        typeof value === 'object' &&
        'toFormDataPart' in value &&
        typeof (value as PreparedUploadFile).toFormDataPart === 'function'
      ) {
        const prepared = value as PreparedUploadFile;
        if (useNativePartObject) {
          rebuilt.append(
            key,
            prepared.toFormDataPart() as unknown as Blob
          );
        } else if (typeof Blob !== 'undefined') {
          const copiedBytes = new Uint8Array(prepared.bytes.byteLength);
          copiedBytes.set(prepared.bytes);
          rebuilt.append(
            key,
            new Blob([copiedBytes], { type: prepared.type }),
            prepared.name
          );
        } else {
          rebuilt.append(
            key,
            prepared.toFormDataPart() as unknown as Blob
          );
        }
      } else if (typeof value === 'string') {
        rebuilt.append(key, value);
      } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
        rebuilt.append(key, value);
      } else {
        rebuilt.append(key, value as unknown as Blob);
      }
    }

    return {
      formData: rebuilt,
      hasFileAttachment: true,
      cleanup: runAllCleanups,
    };
  } catch (err) {
    runAllCleanups();
    throw err;
  }
}
