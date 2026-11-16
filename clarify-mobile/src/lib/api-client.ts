import { API_BASE_URL } from "@/lib/config";
import { clearToken, loadToken } from "@/lib/token-storage";

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "validation"
  | "server"
  | "network";

// Messages from the playbook (§6.3) where it gives them; the rest are our wording.
const MESSAGES = {
  unauthorized: "Your session has expired. Please log in again.",
  forbidden: "Access Denied: you are not allowed to do this.",
  validation: "Please check the highlighted fields.",
  server: "Something went wrong on the server. Please try again.",
  network: "Cannot reach the server. Check your connection and try again.",
  noBaseUrl:
    "The API base URL is not set. Add EXPO_PUBLIC_API_BASE_URL to your .env file.",
} as const;

/** Shown on the login screen after a 401 (playbook §6.3). */
export const SESSION_EXPIRED_MESSAGE: string = MESSAGES.unauthorized;

/** Every failed request throws this, so screens only need one kind of catch. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /** First message for one field, to show under that input in red (playbook §6.3). */
  firstError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0];
  }
}

// The session code registers a function here that sends the user back to login.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Query string values; undefined values are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent as JSON. */
  body?: object;
  /** Sent as multipart form data (file uploads). Do not set Content-Type yourself. */
  formData?: FormData;
  /** Login uses this: a 401 there means wrong credentials, not an expired session. */
  skipUnauthorizedHandling?: boolean;
}

function buildUrl(path: string, query: ApiRequestOptions["query"]): string {
  const pairs: string[] = [];
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        pairs.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
        );
      }
    }
  }
  const queryString = pairs.length > 0 ? `?${pairs.join("&")}` : "";
  return `${API_BASE_URL}${path}${queryString}`;
}

function readMessage(data: unknown): string | null {
  if (typeof data === "object" && data !== null && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return null;
}

function readFieldErrors(data: unknown): Record<string, string[]> {
  if (typeof data === "object" && data !== null && "errors" in data) {
    const errors = (data as { errors: unknown }).errors;
    if (typeof errors === "object" && errors !== null) {
      return errors as Record<string, string[]>;
    }
  }
  return {};
}

/**
 * The only function that talks to the Laravel API.
 * `path` starts with "/", for example "/auth/me". The base URL already ends in /api/v1.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    query,
    body,
    formData,
    skipUnauthorizedHandling = false,
  } = options;

  if (API_BASE_URL.length === 0) {
    throw new ApiError("network", MESSAGES.noBaseUrl);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await loadToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: formData ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    // No connection, wrong IP address, or the server is off.
    throw new ApiError("network", MESSAGES.network);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (response.ok) {
    return data as T;
  }

  if (response.status === 401) {
    if (!skipUnauthorizedHandling) {
      await clearToken();
      onUnauthorized?.();
    }
    throw new ApiError(
      "unauthorized",
      readMessage(data) ?? MESSAGES.unauthorized,
      401,
    );
  }

  if (response.status === 403) {
    throw new ApiError(
      "forbidden",
      readMessage(data) ?? MESSAGES.forbidden,
      403,
    );
  }

  if (response.status === 422) {
    throw new ApiError(
      "validation",
      readMessage(data) ?? MESSAGES.validation,
      422,
      readFieldErrors(data),
    );
  }

  throw new ApiError("server", MESSAGES.server, response.status);
}

/** Turns anything thrown into an ApiError, so screens never crash on unexpected errors. */
export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("server", MESSAGES.server);
}
