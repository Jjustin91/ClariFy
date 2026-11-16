import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ApiError,
  SESSION_EXPIRED_MESSAGE,
  setUnauthorizedHandler,
} from "@/lib/api-client";
import { fetchCurrentUser, login, logout } from "@/lib/services/auth-service";
import { clearToken, loadToken, saveToken } from "@/lib/token-storage";
import type { AuthUser, LoginRequest } from "@/types/api";

type SessionStatus = "loading" | "signedOut" | "signedIn";

interface SessionValue {
  status: SessionStatus;
  user: AuthUser | null;
  /** Set after a 401, so the login screen can explain why the user was sent back. */
  sessionExpiredMessage: string | null;
  /** Replaces the signed-in user after a profile change. */
  updateUser: (user: AuthUser) => void;
  signIn: (request: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<
    string | null
  >(null);

  // 1. When the app opens: is there a saved token that still works?
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = await loadToken();
      if (!token) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      try {
        const currentUser = await fetchCurrentUser();
        if (!cancelled) {
          setUser(currentUser);
          setStatus("signedIn");
        }
      } catch (error) {
        // An invalid token is deleted. A network problem keeps the token; the user just logs in again.
        if (error instanceof ApiError && error.kind === "unauthorized") {
          await clearToken();
        }
        if (!cancelled) setStatus("signedOut");
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Any 401 from the API (playbook §6.3): clear the session and go back to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("signedOut");
      setSessionExpiredMessage(SESSION_EXPIRED_MESSAGE);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (request: LoginRequest) => {
    const result = await login(request); // throws ApiError on failure; the login screen shows it
    await saveToken(result.token);
    setSessionExpiredMessage(null);
    setUser(result.user);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // The user is signed out on this phone even if the server call fails.
    }
    await clearToken();
    setUser(null);
    setStatus("signedOut");
  }, []);

  const updateUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      sessionExpiredMessage,
      signIn,
      signOut,
      updateUser,
    }),
    [status, user, sessionExpiredMessage, signIn, signOut, updateUser],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useAuthSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useAuthSession must be used inside <SessionProvider>.");
  }
  return value;
}
