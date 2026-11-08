'use client';

import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import type { RealtimeEvent } from '../types/api';
import { API_BASE_URL, getStoredToken } from './api-client';

declare global {
  interface Window {
    Pusher?: typeof Pusher;
    __clarifyEchoInstance?: Echo<'reverb'> | null;
    __clarifyEchoToken?: string | null;
  }
}

export interface ReverbBroadcastPayload {
  type: RealtimeEvent['type'];
  channel_id?: number;
  target_user_id?: number;
  action?: RealtimeEvent['action'];
  actor_id?: number;
  announcement?: RealtimeEvent['announcement'];
  message?: RealtimeEvent['message'];
  thread?: RealtimeEvent['thread'];
  timestamp?: string;
}

/**
 * Initializes or retrieves the singleton Laravel Echo client configured for Laravel Reverb
 * using Sanctum bearer authentication against /api/v1/broadcasting/auth for private channels.
 */
export function getReverbEcho(): Echo<'reverb'> | null {
  if (typeof window === 'undefined') return null;

  const currentToken = getStoredToken();
  if (!currentToken) {
    return null;
  }

  if (
    window.__clarifyEchoInstance &&
    window.__clarifyEchoToken === currentToken
  ) {
    return window.__clarifyEchoInstance;
  }

  const envKey = process.env.NEXT_PUBLIC_REVERB_APP_KEY;
  const envHost = process.env.NEXT_PUBLIC_REVERB_HOST;
  const envPort = process.env.NEXT_PUBLIC_REVERB_PORT;
  const envScheme = process.env.NEXT_PUBLIC_REVERB_SCHEME;

  const isLocalBrowser =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  // Only attempt WebSocket connection if explicitly configured via env or running locally with Reverb
  if (!envKey && !isLocalBrowser) {
    window.__clarifyEchoInstance = null;
    return null;
  }

  try {
    if (window.__clarifyEchoInstance) {
      try {
        window.__clarifyEchoInstance.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    window.Pusher = Pusher;
    Pusher.logToConsole = false;

    const key = envKey || 'clarify-reverb-key';
    const wsHost = envHost || '127.0.0.1';
    const wsPort = Number(envPort || 8080);
    const forceTLS = (envScheme || 'http') === 'https';

    const echo = new Echo({
      broadcaster: 'reverb',
      key,
      wsHost,
      wsPort,
      wssPort: wsPort,
      forceTLS,
      enabledTransports: ['ws', 'wss'],
      disableStats: true,
      authEndpoint: `${API_BASE_URL}/broadcasting/auth`,
      auth: {
        headers: {
          Authorization: `Bearer ${currentToken}`,
          Accept: 'application/json',
        },
      },
    });

    window.__clarifyEchoInstance = echo;
    window.__clarifyEchoToken = currentToken;
    return echo;
  } catch {
    window.__clarifyEchoInstance = null;
    return null;
  }
}

/**
 * Subscribes to the private global ClariFy Reverb channel (`clarify.global`) for
 * minimal notice metadata (type + IDs only) and private per-user channel (`clarify.user.{userId}`).
 */
export function subscribeGlobalReverb(
  onEvent: (payload: ReverbBroadcastPayload) => void,
  userId?: number,
  onReconnect?: () => void
): () => void {
  const echo = getReverbEcho();
  if (!echo) {
    return () => {};
  }

  try {
    const globalChannel = echo.private('clarify.global');
    globalChannel.listen('.realtime.updated', (data: ReverbBroadcastPayload) => {
      onEvent(data);
    });

    const userChannel =
      userId && userId > 0 ? echo.private(`clarify.user.${userId}`) : null;
    if (userChannel) {
      userChannel.listen('.realtime.updated', (data: ReverbBroadcastPayload) => {
        onEvent(data);
      });
    }

    const pusherConnection = (
      echo.connector as unknown as {
        pusher?: {
          connection?: {
            bind?: (
              eventName: string,
              cb: (states: { previous?: string; current?: string }) => void
            ) => void;
            unbind?: (
              eventName: string,
              cb: (states: { previous?: string; current?: string }) => void
            ) => void;
          };
        };
      }
    )?.pusher?.connection;

    let hasConnectedOnce = false;
    const handleStateChange = (states: {
      previous?: string;
      current?: string;
    }) => {
      if (states?.current === 'connected') {
        if (hasConnectedOnce && states.previous !== 'initialized') {
          onReconnect?.();
        }
        hasConnectedOnce = true;
      }
    };

    if (pusherConnection && typeof pusherConnection.bind === 'function') {
      pusherConnection.bind('state_change', handleStateChange);
    }

    return () => {
      try {
        if (pusherConnection && typeof pusherConnection.unbind === 'function') {
          pusherConnection.unbind('state_change', handleStateChange);
        }
        globalChannel.stopListening('.realtime.updated');
        if (userChannel) {
          userChannel.stopListening('.realtime.updated');
        }
      } catch {
        // Ignore cleanup errors
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Subscribes to a private Course Hub Reverb channel (`clarify.channel.{channelId}`)
 * authorized via ChannelPolicy for low-latency Live Channel Chat & Isolated Q&A Thread updates.
 */
export function subscribeChannelReverb(
  channelId: number,
  onEvent: (payload: ReverbBroadcastPayload) => void
): () => void {
  const echo = getReverbEcho();
  if (!echo || !channelId) {
    return () => {};
  }

  try {
    const channelName = `clarify.channel.${channelId}`;
    const channel = echo.private(channelName);
    channel.listen('.realtime.updated', (data: ReverbBroadcastPayload) => {
      onEvent(data);
    });

    return () => {
      try {
        channel.stopListening('.realtime.updated');
      } catch {
        // Ignore cleanup errors
      }
    };
  } catch {
    return () => {};
  }
}
