import { NextRequest } from 'next/server';
import {
  checkAndRecordDbFingerprint,
  getCurrentRevision,
  getEventsSinceRevision,
  subscribeRealtime,
} from '@/src/server/realtime-bus';
import { getPostgresFingerprint } from '@/src/server/postgres-adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sinceParam = req.nextUrl.searchParams.get('since_revision');
  const sinceRevision = sinceParam ? Number(sinceParam) : 0;

  // If polled with ?poll=1, return JSON immediately for environments where SSE is buffered
  if (req.nextUrl.searchParams.get('poll') === '1') {
    const fp = await getPostgresFingerprint();
    if (fp) {
      checkAndRecordDbFingerprint(fp);
    }
    const events = getEventsSinceRevision(sinceRevision);
    return Response.json({
      revision: getCurrentRevision(),
      events,
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const sendEvent = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Send initial connected state
      sendEvent({
        revision: getCurrentRevision(),
        type: 'connected',
        timestamp: new Date().toISOString(),
      });

      // Catch up missed events if client reconnected
      if (sinceRevision > 0) {
        const missed = getEventsSinceRevision(sinceRevision);
        for (const ev of missed) {
          sendEvent(ev);
        }
      }

      const unsubscribe = subscribeRealtime((event) => {
        sendEvent(event);
      });

      // Poll PostgreSQL fingerprint every 2s so external DB / Laravel mutations also push live
      const dbPollTimer = setInterval(async () => {
        if (closed) return;
        const fp = await getPostgresFingerprint();
        if (fp) {
          checkAndRecordDbFingerprint(fp);
        }
      }, 2000);

      // Keepalive comment every 15s
      const keepAliveTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(dbPollTimer);
        clearInterval(keepAliveTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Ignore close errors
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
