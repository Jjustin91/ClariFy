'use client';

import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import type { RealtimeEvent } from '../types/api';

declare global {
  interface Window {
    Pusher?: typeof Pusher;
    __clarifyEchoInstance?: Echo<'reverb'> | null;
  }
}

export interface ReverbBroadcastPayload {
  type: RealtimeEvent['type'];
  channel_id?: number;
  actor_id?: number;
  announcement?: RealtimeEvent['announcement'];
  message?: RealtimeEvent['message'];
  thread?: RealtimeEvent['thread'];
  timestamp?: string;
}

/**
 * Initializes or retrieves the singleton Laravel Echo client configured for Laravel Reverb.
 * Automatically connects when NEXT_PUBLIC_REVERB_APP_KEY is configured (or defaults to clarify-reverb-key on localhost).
 */
export function getReverbEcho(): Echo<'reverb'> | null {
  if (typeof window === 'undefined') return null;

  if (window.__clarifyEchoInstance !== undefined) {
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
    window.Pusher = Pusher;
    // Suppress noisy Pusher console logs if local Reverb daemon isn't started yet
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
    });

    window.__clarifyEchoInstance = echo;
    return echo;
  } catch {
    window.__clarifyEchoInstance = null;
    return null;
  }
}

/**
 * Subscribes to the global ClariFy Reverb channel (`clarify.global`) for
 * Urgent Announcement Popups, Live Acknowledgment Counters, Course Hub Chat, and Q&A Threads.
 */
export function subscribeGlobalReverb(
  onEvent: (payload: ReverbBroadcastPayload) => void
): () => void {
  const echo = getReverbEcho();
  if (!echo) {
    return () => {};
  }

  try {
    const channel = echo.channel('clarify.global');
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

/**
 * Subscribes to a specific Course Hub Reverb channel (`clarify.channel.{channelId}`)
 * for low-latency Live Channel Chat & Isolated Q&A Thread updates.
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
    const channel = echo.channel(channelName);
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
