import { ApiError, apiRequest } from "@/lib/api-client";
import { USE_MOCKS } from "@/lib/config";
import { loadToken } from "@/lib/token-storage";
import { MOCK_LOGIN_ACCOUNTS } from "@/mocks";
import type {
    ApiItemResponse,
    AuthUser,
    LoginRequest,
    LoginResult,
} from "@/types/api";

const MOCK_TOKEN_PREFIX = "mock-token-";

/** Pretends the network takes a moment, so loading states are visible in mock mode. */
const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** POST /auth/login. Real response shape ASSUMED: { data: { token, user } }. */
export async function login(request: LoginRequest): Promise<LoginResult> {
  if (USE_MOCKS) {
    await wait(700);

    // Mimics a Laravel 422 response (playbook §6.3).
    const fieldErrors: Record<string, string[]> = {};
    if (request.institutional_id.length === 0) {
      fieldErrors.institutional_id = [
        "The institutional id field is required.",
      ];
    }
    if (request.password.length === 0) {
      fieldErrors.password = ["The password field is required."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(
        "validation",
        "Please check the highlighted fields.",
        422,
        fieldErrors,
      );
    }

    const account = MOCK_LOGIN_ACCOUNTS.find(
      (item) =>
        item.institutional_id === request.institutional_id &&
        item.password === request.password,
    );
    if (!account) {
      const message = "These credentials do not match our records.";
      throw new ApiError("validation", message, 422, {
        institutional_id: [message],
      });
    }
    return {
      token: `${MOCK_TOKEN_PREFIX}${account.user.id}`,
      user: account.user,
    };
  }

  // A 401 on login means wrong credentials, not an expired session.
  const response = await apiRequest<ApiItemResponse<LoginResult>>(
    "/auth/login",
    {
      method: "POST",
      body: request,
      skipUnauthorizedHandling: true,
    },
  );
  return response.data;
}

/** GET /auth/me. Real response shape ASSUMED: { data: AuthUser }. */
export async function fetchCurrentUser(): Promise<AuthUser> {
  if (USE_MOCKS) {
    await wait(300);
    const token = await loadToken();
    if (!token || !token.startsWith(MOCK_TOKEN_PREFIX)) {
      throw new ApiError("unauthorized", "Not signed in.", 401);
    }
    const userId = Number(token.slice(MOCK_TOKEN_PREFIX.length));
    const account = MOCK_LOGIN_ACCOUNTS.find((item) => item.user.id === userId);
    if (!account) {
      throw new ApiError("unauthorized", "Not signed in.", 401);
    }
    return account.user;
  }

  const response = await apiRequest<ApiItemResponse<AuthUser>>("/auth/me");
  return response.data;
}

/** POST /auth/logout. */
export async function logout(): Promise<void> {
  if (USE_MOCKS) {
    return;
  }
  await apiRequest<unknown>("/auth/logout", { method: "POST" });
}
