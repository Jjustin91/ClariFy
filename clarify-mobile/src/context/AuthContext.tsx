import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getMeApi,
  loginApi,
  logoutApi,
  onSessionExpired,
  registerDeviceForPushNotificationsAsync,
} from '../lib/api-client';
import {
  clearSecureToken,
  getSecureToken,
} from '../lib/secure-token';
import type { ApiError, User } from '../types/api';

export interface ToastNotice {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

export interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isAuthReady: boolean;
  sessionExpiredMessage: string | null;
  toasts: ToastNotice[];
  login: (institutionalId: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  clearSession: (expiredMessage?: string | null) => Promise<void>;
  dismissSessionExpiredMessage: () => void;
  showToast: (message: string, variant?: ToastNotice['variant']) => void;
  dismissToast: (id: string) => void;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<
    string | null
  >(null);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastNotice['variant'] = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 4000);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const dismissSessionExpiredMessage = useCallback(() => {
    setSessionExpiredMessage(null);
  }, []);

  const clearSession = useCallback(async (expiredMessage?: string | null) => {
    await clearSecureToken();
    setUserState(null);
    if (expiredMessage) {
      setSessionExpiredMessage(expiredMessage);
    }
  }, []);

  // Listen for 401 Unauthorized responses across any authenticated API call
  useEffect(() => {
    const unsubscribe = onSessionExpired((message) => {
      setUserState(null);
      setSessionExpiredMessage(
        message || 'Your session has expired. Please sign in again.'
      );
    });
    return unsubscribe;
  }, []);

  // Hydrate token from expo-secure-store and fetch active user profile via GET /auth/me on cold launch
  useEffect(() => {
    let isMounted = true;

    const bootstrapSession = async () => {
      try {
        const storedToken = await getSecureToken();
        if (!storedToken) {
          if (isMounted) {
            setUserState(null);
            setIsAuthReady(true);
          }
          return;
        }

        const meRes = await getMeApi();
        if (isMounted && meRes?.data) {
          setUserState(meRes.data);
          void registerDeviceForPushNotificationsAsync();
        }
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr?.status === 401 || apiErr?.status === 403) {
          await clearSecureToken();
          if (isMounted) {
            setUserState(null);
            if (apiErr.status === 401) {
              setSessionExpiredMessage(
                'Your session has expired. Please sign in again.'
              );
            }
          }
        }
      } finally {
        if (isMounted) {
          setIsAuthReady(true);
        }
      }
    };

    void bootstrapSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(
    async (institutionalId: string, password: string): Promise<User> => {
      setSessionExpiredMessage(null);
      const { user: authenticatedUser } = await loginApi(
        institutionalId,
        password
      );
      setUserState(authenticatedUser);
      const domainLabel =
        authenticatedUser.role === 'faculty' ||
        authenticatedUser.role === 'dept_head'
          ? 'Faculty Domain'
          : authenticatedUser.role === 'it_admin'
            ? 'IT Admin Domain'
            : 'Student Domain';
      showToast(
        `Signed in to ${domainLabel} as ${authenticatedUser.name}.`,
        'success'
      );
      void registerDeviceForPushNotificationsAsync();
      return authenticatedUser;
    },
    [showToast]
  );

  const logout = useCallback(async () => {
    await logoutApi();
    setUserState(null);
    setSessionExpiredMessage(null);
    showToast('Signed out of ClariFy Mobile.', 'info');
  }, [showToast]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user && user.id > 0),
      isAuthReady,
      sessionExpiredMessage,
      toasts,
      login,
      logout,
      clearSession,
      dismissSessionExpiredMessage,
      showToast,
      dismissToast,
      setUser: setUserState,
    }),
    [
      user,
      isAuthReady,
      sessionExpiredMessage,
      toasts,
      login,
      logout,
      clearSession,
      dismissSessionExpiredMessage,
      showToast,
      dismissToast,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
