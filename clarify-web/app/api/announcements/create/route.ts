import { NextRequest, NextResponse } from 'next/server';
import {
  getPostgresStatusInfo,
  handlePostgresApiRequest,
  tryProxyToLaravel,
} from '@/src/server/postgres-adapter';
import { emitRealtimeEvent } from '@/src/server/realtime-bus';

/**
 * TC-NFR01 Automated Grading Alias Route: POST /api/announcements/create
 * Mirrors routes/api.php line 18 in clarify-api and persists directly to PostgreSQL or Render proxy.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const headers = {
    authorization: req.headers.get('authorization') || undefined,
    'x-clarify-institutional-id':
      req.headers.get('x-clarify-institutional-id') || undefined,
    'x-clarify-user-id': req.headers.get('x-clarify-user-id') || undefined,
  };

  let result = await handlePostgresApiRequest({
    method: 'POST',
    path: '/announcements/create',
    headers,
    body,
  });

  if (!result) {
    const proxied = await tryProxyToLaravel(
      'POST',
      '/announcements',
      req.nextUrl.searchParams,
      headers,
      body
    );
    result = proxied.result;
  }

  if (!result) {
    const pgStatus = await getPostgresStatusInfo();
    return NextResponse.json(
      {
        status: 503,
        message: `PostgreSQL connection unavailable (${
          pgStatus.error || 'Ensure PostgreSQL is running'
        }).`,
      },
      { status: 503 }
    );
  }

  if (result.status >= 200 && result.status < 300) {
    emitRealtimeEvent('announcement.created', {
      channel_id: body.channel_id ? Number(body.channel_id) : undefined,
    });
  }

  return NextResponse.json(result.body, { status: result.status });
}
