import Echo from 'laravel-echo';
import PusherImport from 'pusher-js';

import type { RealtimeEvent } from '../types/api.ts';
import { API_BASE_URL } from './api-client.ts';
import { getCachedBearerToken } from './secure-token.ts';

const Pusher: typeof PusherImport =
  (PusherImport as unknown as { Pusher?: typeof PusherImport }).Pusher ??
  PusherImport;

export interface ReverbBroadcastPayload {
  type: RealtimeEvent['type'];
  channel_id?: number;
  message_id?: number;
  target_user_id?: number;
  action?: RealtimeEvent['action'];
  actor_id?: number;
  announcement?: RealtimeEvent['announcement'];
  message?: RealtimeEvent['message'];
  thread?: RealtimeEvent['thread'];
  timestamp?: string;
}

export type ReverbConnectionState =
  | 'unconfigured'
  | 'initialized'
  | 'connecting'
  | 'connected'
  | 'unavailable'
  | 'failed'
  | 'disconnected';

export type ReverbConfigurationStatus =
  | { configured: true; config: ResolvedReverbConfig }
  | {
      configured: false;
      reason: 'missing_app_key';
      message: string;
    };

export interface ResolvedReverbConfig {
  key: string;
  wsHost: string;
  wsPort: number;
  wssPort: number;
  forceTLS: boolean;
  enabledTransports: ('ws' | 'wss')[];
  authEndpoint: string;
  isLocalHost: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

function parseApiUrl(apiBaseUrl: string): { host: string; isHttps: boolean } {
  try {
    const parsed = new URL(apiBaseUrl);
    return {
      host: parsed.hostname || 'api.ustpclarify.tech',
      isHttps: parsed.protocol === 'https:',
    };
  } catch {
    return {
      host: 'api.ustpclarify.tech',
      isHttps: true,
    };
  }
}

/**
 * Resolves Reverb WebSocket connection config from EXPO_PUBLIC_REVERB_* env vars
 * and API_BASE_URL. Enforces WSS on port 443 (no cleartext WS) for all non-local hosts.
 */
export function resolveReverbConfig(
  env: Record<string, string | undefined> = process.env,
  apiBaseUrl: string = API_BASE_URL
): ResolvedReverbConfig | null {
  const normalizedApiBase = apiBaseUrl.replace(/\/+$/, '');
  const apiInfo = parseApiUrl(normalizedApiBase);

  const envKey = env.EXPO_PUBLIC_REVERB_APP_KEY?.trim() || '';
  const envHost = env.EXPO_PUBLIC_REVERB_HOST?.trim() || '';
  const envPort = env.EXPO_PUBLIC_REVERB_PORT?.trim() || '';
  const envScheme = env.EXPO_PUBLIC_REVERB_SCHEME?.trim().toLowerCase() || '';

  const wsHost = envHost || apiInfo.host;
  const isLocalHost = LOCAL_HOSTS.has(wsHost.toLowerCase());

  if (!envKey && !isLocalHost) {
    return null;
  }

  const key = envKey || 'clarify-reverb-key';

  // Production traffic MUST use WSS only; local development may use ws/wss.
  const forceTLS = isLocalHost
    ? (envScheme ? envScheme === 'https' : apiInfo.isHttps)
    : true;

  const defaultPort = forceTLS ? 443 : 8080;
  const parsedPort = Number(envPort);
  const resolvedPort =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : defaultPort;

  return {
    key,
    wsHost,
    wsPort: resolvedPort,
    wssPort: resolvedPort,
    forceTLS,
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${normalizedApiBase}/broadcasting/auth`,
    isLocalHost,
  };
}

/**
 * Returns whether Reverb realtime is configured for the active environment,
 * plus a user-facing status message when EXPO_PUBLIC_REVERB_APP_KEY is blank on a non-local host.
 */
export function getReverbConfigurationStatus(
  env: Record<string, string | undefined> = process.env,
  apiBaseUrl: string = API_BASE_URL
): ReverbConfigurationStatus {
  const config = resolveReverbConfig(env, apiBaseUrl);
  if (!config) {
    return {
      configured: false,
      reason: 'missing_app_key',
      message:
        'Live updates unavailable. Pull down to refresh announcements and chat.',
    };
  }
  return { configured: true, config };
}

let echoInstance: Echo<'reverb'> | null = null;
let echoToken: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

const channelListenersByHubId = new Map<
  number,
  Set<(payload: ReverbBroadcastPayload) => void>
>();

interface PusherConnectionLike {
  state?: string;
  bind?: (
    eventName: string,
    cb: (states: { previous?: string; current?: string }) => void
  ) => void;
  unbind?: (
    eventName: string,
    cb: (states: { previous?: string; current?: string }) => void
  ) => void;
  connect?: () => void;
}

function getPusherConnection(
  echo: Echo<'reverb'> | null
): PusherConnectionLike | undefined {
  if (!echo) return undefined;
  return (
    echo.connector as unknown as {
      pusher?: {
        connection?: PusherConnectionLike;
      };
    }
  )?.pusher?.connection;
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Computes capped exponential backoff with jitter (1s -> 2s -> 4s ... max 30s).
 */
export function computeReconnectBackoffMs(
  attempt: number,
  randomValue: number = Math.random()
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const clampedRandom = Math.min(0.9999, Math.max(0, randomValue));
  const baseMs = Math.min(30000, 1000 * Math.pow(2, safeAttempt));
  const jitterMs = Math.floor(clampedRandom * 500);
  return baseMs + jitterMs;
}

function scheduleManualReconnect(echo: Echo<'reverb'>): void {
  if (reconnectTimer || echoInstance !== echo) {
    return;
  }
  const delayMs = computeReconnectBackoffMs(reconnectAttempt);
  reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (echoInstance !== echo || !getCachedBearerToken()) {
      return;
    }
    const conn = getPusherConnection(echo);
    if (
      conn &&
      typeof conn.connect === 'function' &&
      conn.state !== 'connected' &&
      conn.state !== 'connecting'
    ) {
      try {
        conn.connect();
      } catch {
        // Ignore transient connect errors
      }
    }
  }, delayMs);
}

/**
 * Tears down the active Reverb WebSocket connection, cancels reconnect timers,
 * and clears multiplexed channel listeners (used on logout and AppState background).
 */
export function disconnectReverb(): void {
  clearReconnectTimer();
  reconnectAttempt = 0;
  channelListenersByHubId.clear();

  if (echoInstance) {
    try {
      echoInstance.leaveAllChannels();
      echoInstance.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
  echoInstance = null;
  echoToken = null;
}

/**
 * Initializes or retrieves the singleton Laravel Echo client configured for Laravel Reverb
 * over WSS using Sanctum bearer authentication against POST {API_BASE_URL}/broadcasting/auth.
 * Never connects anonymously: returns null if no bearer token is hydrated from expo-secure-store.
 */
export function getReverbEcho(): Echo<'reverb'> | null {
  const currentToken = getCachedBearerToken();
  if (!currentToken) {
    disconnectReverb();
    return null;
  }

  if (echoInstance && echoToken === currentToken) {
    return echoInstance;
  }

  const config = resolveReverbConfig();
  if (!config) {
    disconnectReverb();
    return null;
  }

  try {
    disconnectReverb();

    // Never log tokens, auth headers, or private payloads
    Pusher.logToConsole = false;

    const echo = new Echo({
      broadcaster: 'reverb',
      Pusher,
      key: config.key,
      wsHost: config.wsHost,
      wsPort: config.wsPort,
      wssPort: config.wssPort,
      forceTLS: config.forceTLS,
      enabledTransports: config.enabledTransports,
      disableStats: true,
      authEndpoint: config.authEndpoint,
      auth: {
        headers: {
          Authorization: `Bearer ${currentToken}`,
          Accept: 'application/json',
        },
      },
    });

    echoInstance = echo;
    echoToken = currentToken;
        if (__DEV__) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawPusher = (echo.connector as any)?.pusher;
      rawPusher?.bind_global(
        (eventName: string, data: { type?: string; channel_id?: number }) => {
          if (!String(eventName).startsWith('pusher')) {
            console.log('[reverb] RAW event', eventName, data?.type, data?.channel_id);
          }
        }
      );
    }
    return echo;
  } catch {
    disconnectReverb();
    return null;
  }
}

/**
 * Subscribes to private `clarify.global` (minimal metadata: type + IDs only)
 * and private `clarify.user.{userId}` (membership + admin updates).
 */
export function subscribeGlobalReverb(
  onEvent: (payload: ReverbBroadcastPayload) => void,
  userId?: number,
  onReconnect?: () => void,
  onStateChange?: (state: ReverbConnectionState) => void
): () => void {
  const configStatus = getReverbConfigurationStatus();
  if (!configStatus.configured) {
    onStateChange?.('unconfigured');
    return () => {};
  }

  const echo = getReverbEcho();
  if (!echo) {
    onStateChange?.('disconnected');
    return () => {};
  }

  try {
    const globalChannel = echo.private('clarify.global');
    globalChannel.listen('.realtime.updated', (data: ReverbBroadcastPayload) => {
      onEvent(data);
    });

    const hasUserChannel = Boolean(userId && userId > 0);
    const userChannelName = hasUserChannel ? `clarify.user.${userId}` : null;
    const userChannel = userChannelName ? echo.private(userChannelName) : null;
    if (userChannel) {
      userChannel.listen('.realtime.updated', (data: ReverbBroadcastPayload) => {
        onEvent(data);
      });
    }

    const pusherConnection = getPusherConnection(echo);
    let hasConnectedOnce = pusherConnection?.state === 'connected';
    if (pusherConnection?.state) {
      onStateChange?.(pusherConnection.state as ReverbConnectionState);
    }

    const handleStateChange = (states: {
      previous?: string;
      current?: string;
    }) => {
      const nextState = (states?.current || 'disconnected') as ReverbConnectionState;
      onStateChange?.(nextState);

      if (nextState === 'connected') {
        clearReconnectTimer();
        reconnectAttempt = 0;
        if (hasConnectedOnce && states.previous !== 'initialized') {
          onReconnect?.();
        }
        hasConnectedOnce = true;
      } else if (
        nextState === 'disconnected' ||
        nextState === 'unavailable' ||
        nextState === 'failed'
      ) {
        scheduleManualReconnect(echo);
      }
    };

    if (pusherConnection && typeof pusherConnection.bind === 'function') {
      pusherConnection.bind('state_change', handleStateChange);
    }

    return () => {
      try {
        clearReconnectTimer();
        if (pusherConnection && typeof pusherConnection.unbind === 'function') {
          pusherConnection.unbind('state_change', handleStateChange);
        }
        globalChannel.stopListening('.realtime.updated');
        if (userChannel && userChannelName) {
          userChannel.stopListening('.realtime.updated');
        }
        if (echoInstance === echo) {
          echo.leave('clarify.global');
          if (userChannelName) {
            echo.leave(userChannelName);
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    };
  } catch {
    onStateChange?.('disconnected');
    return () => {};
  }
}

/**
 * Subscribes to a private Course Hub Reverb channel (`clarify.channel.{channelId}`)
 * authorized via ChannelPolicy. Multiplexes listeners per `channelId` so multiple
 * consumers can subscribe/unsubscribe independently without detaching active listeners.
 */
export function subscribeChannelReverb(
  channelId: number,
  onEvent: (payload: ReverbBroadcastPayload) => void
): () => void {
  const numericId = Number(channelId);
  const echo = getReverbEcho();
    if (__DEV__) {
    console.log('[reverb] subscribeChannel called', numericId, 'echo:', Boolean(echo));   // <-- NEW 1
  }
  if (!echo || !numericId || numericId <= 0) {
    return () => {};
  }

  try {
    const channelName = `clarify.channel.${numericId}`;
    let listeners = channelListenersByHubId.get(numericId);
    if (!listeners) {
      listeners = new Set();
      channelListenersByHubId.set(numericId, listeners);
      const channel = echo.private(channelName);
      if (__DEV__) {                                                                       // <-- NEW 2
        channel
          .subscribed(() => console.log('[reverb] subscribed', channelName))
          .error((e: unknown) =>
            console.log('[reverb] channel subscription_error', channelName, JSON.stringify(e))
          );
      }
      channel.listen('.realtime.updated', (data: ReverbBroadcastPayload) => {
        if (__DEV__) {                                                                     // <-- NEW 3
          console.log('[reverb] event on', channelName, data?.type, 'listeners:', channelListenersByHubId.get(numericId)?.size);
        }
        const activeSet = channelListenersByHubId.get(numericId);
        if (!activeSet) return;
        activeSet.forEach((cb) => {
          try {
            cb(data);
          } catch {
            // Ignore subscriber callback error
          }
        });
      });
    }

    listeners.add(onEvent);

    return () => {
      try {
        const activeSet = channelListenersByHubId.get(numericId);
        if (!activeSet) return;
        activeSet.delete(onEvent);
        if (activeSet.size === 0) {
          channelListenersByHubId.delete(numericId);
          if (echoInstance === echo) {
            echo.private(channelName).stopListening('.realtime.updated');
            echo.leave(channelName);
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    };
  } catch {
    return () => {};
  }
}
