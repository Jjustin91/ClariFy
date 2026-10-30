import type { RealtimeEvent } from '../types/api';

type RealtimeSubscriber = (event: RealtimeEvent) => void;

interface RealtimeBusState {
  revision: number;
  subscribers: Set<RealtimeSubscriber>;
  history: RealtimeEvent[];
  lastDbFingerprint: string;
}

const globalForRealtime = globalThis as unknown as {
  __clarifyRealtimeBus?: RealtimeBusState;
};

function getBus(): RealtimeBusState {
  if (!globalForRealtime.__clarifyRealtimeBus) {
    globalForRealtime.__clarifyRealtimeBus = {
      revision: 1,
      subscribers: new Set<RealtimeSubscriber>(),
      history: [],
      lastDbFingerprint: '',
    };
  }
  return globalForRealtime.__clarifyRealtimeBus;
}

export function getCurrentRevision(): number {
  return getBus().revision;
}

export function emitRealtimeEvent(
  type: RealtimeEvent['type'],
  options?: { channel_id?: number; actor_id?: number }
): RealtimeEvent {
  const bus = getBus();
  bus.revision += 1;
  const event: RealtimeEvent = {
    revision: bus.revision,
    type,
    channel_id: options?.channel_id,
    actor_id: options?.actor_id,
    timestamp: new Date().toISOString(),
  };

  bus.history.push(event);
  if (bus.history.length > 100) {
    bus.history.shift();
  }

  bus.subscribers.forEach((sub) => {
    try {
      sub(event);
    } catch {
      // Ignore subscriber errors from closed streams
    }
  });

  return event;
}

export function subscribeRealtime(subscriber: RealtimeSubscriber): () => void {
  const bus = getBus();
  bus.subscribers.add(subscriber);
  return () => {
    bus.subscribers.delete(subscriber);
  };
}

export function getEventsSinceRevision(sinceRevision: number): RealtimeEvent[] {
  const bus = getBus();
  return bus.history.filter((e) => e.revision > sinceRevision);
}

export function checkAndRecordDbFingerprint(fingerprint: string): boolean {
  const bus = getBus();
  if (!bus.lastDbFingerprint) {
    bus.lastDbFingerprint = fingerprint;
    return false;
  }
  if (bus.lastDbFingerprint !== fingerprint) {
    bus.lastDbFingerprint = fingerprint;
    emitRealtimeEvent('db.changed');
    return true;
  }
  return false;
}
