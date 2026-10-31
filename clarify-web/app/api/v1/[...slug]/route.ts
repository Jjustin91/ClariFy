import { NextRequest, NextResponse } from 'next/server';
import {
  getPostgresStatusInfo,
  handlePostgresApiRequest,
} from '@/src/server/postgres-adapter';
import {
  emitRealtimeEvent,
  getCurrentRevision,
} from '@/src/server/realtime-bus';
import type { PersistenceStatus, RealtimeEvent } from '@/src/types/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function parseRequestBody(
  req: NextRequest
): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return {};
  }

  const contentType = req.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const obj: Record<string, unknown> = {};
      formData.forEach((value, key) => {
        if (typeof value === 'string') {
          obj[key] = value;
        } else if (value && typeof value === 'object' && 'name' in value) {
          obj[key] = value.name;
          if (!obj.attachment_name) {
            obj.attachment_name = value.name;
          }
        }
      });
      return obj;
    }
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function classifyMutationEvent(
  method: string,
  apiPath: string,
  body: Record<string, unknown>
): { type: RealtimeEvent['type']; channel_id?: number } | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return null;

  if (apiPath === '/announcements' || apiPath === '/announcements/create') {
    return {
      type: 'announcement.created',
      channel_id: body.channel_id ? Number(body.channel_id) : undefined,
    };
  }
  if (/^\/announcements\/\d+\/acknowledge$/.test(apiPath)) {
    return { type: 'announcement.acknowledged' };
  }
  if (/^\/announcements\/\d+$/.test(apiPath)) {
    return {
      type: m === 'DELETE' ? 'announcement.deleted' : 'announcement.updated',
    };
  }
  const chatMatch = apiPath.match(/^\/channels\/(\d+)\/chat$/);
  if (chatMatch) {
    return {
      type: 'chat.message',
      channel_id: Number(chatMatch[1]),
    };
  }
  const threadCreateMatch = apiPath.match(/^\/channels\/(\d+)\/threads$/);
  if (threadCreateMatch) {
    return {
      type: 'thread.created',
      channel_id: Number(threadCreateMatch[1]),
    };
  }
  if (/^\/threads\/\d+\/replies$/.test(apiPath)) {
    return { type: 'thread.replied' };
  }
  if (/^\/threads\/\d+\/convert-faq$/.test(apiPath)) {
    return { type: 'thread.faq_pinned' };
  }
  if (/^\/threads\/\d+$/.test(apiPath)) {
    return {
      type: m === 'DELETE' ? 'thread.deleted' : 'thread.updated',
    };
  }
  if (apiPath === '/channels') {
    return { type: 'channel.created' };
  }
  if (/^\/channels\/\d+\/(join|members)$/.test(apiPath)) {
    return { type: 'channel.updated' };
  }
  if (apiPath.startsWith('/admin/') || apiPath === '/profile') {
    return { type: 'admin.updated' };
  }
  return null;
}

async function tryProxyToLaravel(
  method: string,
  apiPath: string,
  searchParams: URLSearchParams,
  headers: Record<string, string | undefined>,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const laravelBase = process.env.LARAVEL_BACKEND_URL?.trim();
  if (!laravelBase) return null;

  const qs = searchParams.toString();
  const targetUrl = `${laravelBase.replace(/\/$/, '')}/api/v1${apiPath}${
    qs ? `?${qs}` : ''
  }`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(targetUrl, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(headers.authorization
          ? { Authorization: headers.authorization }
          : {}),
        ...(headers['x-clarify-institutional-id']
          ? {
              'X-Clarify-Institutional-Id':
                headers['x-clarify-institutional-id'],
            }
          : {}),
        ...(headers['x-clarify-user-id']
          ? { 'X-Clarify-User-Id': headers['x-clarify-user-id'] }
          : {}),
      },
      body:
        method === 'GET' || method === 'HEAD'
          ? undefined
          : JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status >= 500 || res.status === 404) {
      return null;
    }

    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { status: res.status, body: json };
  } catch {
    return null;
  }
}

async function handleRoute(
  req: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
): Promise<NextResponse> {
  const { slug } = await context.params;
  const apiPath = `/${(slug || []).join('/')}`;

  const body = await parseRequestBody(req);
  const effectiveMethod =
    typeof body._method === 'string' ? body._method.toUpperCase() : req.method;

  // Endpoint to inspect active database driver & real-time revision
  if (effectiveMethod === 'GET' && apiPath === '/persistence/status') {
    const pgStatus = await getPostgresStatusInfo();
    const statusPayload: PersistenceStatus = pgStatus.connected
      ? {
          driver: 'postgresql-direct',
          database: pgStatus.database,
          host: pgStatus.host,
          connected: true,
          revision: getCurrentRevision(),
        }
      : {
          driver: 'laravel-postgresql',
          connected: false,
          revision: getCurrentRevision(),
        };
    return NextResponse.json({ data: statusPayload }, { status: 200 });
  }

  const query: Record<string, string | undefined> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const authHeader = req.headers.get('authorization') || undefined;
  const instHeader =
    req.headers.get('x-clarify-institutional-id') || undefined;
  const userIdHeader = req.headers.get('x-clarify-user-id') || undefined;

  const headers: Record<string, string | undefined> = {
    authorization: authHeader,
    'x-clarify-institutional-id': instHeader,
    'x-clarify-user-id': userIdHeader,
  };

  // 1. Direct PostgreSQL execution (persists immediately into PostgreSQL database)
  let result = await handlePostgresApiRequest({
    method: effectiveMethod,
    path: apiPath,
    query,
    headers,
    body,
  });

  // 2. If direct PostgreSQL is not reachable, proxy to Laravel 13 Backend if configured
  if (!result) {
    result = await tryProxyToLaravel(
      effectiveMethod,
      apiPath,
      req.nextUrl.searchParams,
      headers,
      body
    );
  }

  // 3. If neither PostgreSQL nor Laravel is reachable, return explicit 503 error (no mock fallback)
  if (!result) {
    const pgStatus = await getPostgresStatusInfo();
    return NextResponse.json(
      {
        status: 503,
        message: `PostgreSQL database connection unavailable (${
          pgStatus.error ||
          'Check DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD in .env'
        }). Please ensure PostgreSQL is running. See HOW_TO_RUN.md for setup instructions.`,
      },
      { status: 503 }
    );
  }

  // Broadcast real-time event whenever a mutation succeeds
  if (result.status >= 200 && result.status < 300) {
    const ev = classifyMutationEvent(effectiveMethod, apiPath, body);
    if (ev) {
      emitRealtimeEvent(ev.type, { channel_id: ev.channel_id });
    }
  }

  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
) {
  return handleRoute(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
) {
  return handleRoute(req, context);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
) {
  return handleRoute(req, context);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
) {
  return handleRoute(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ slug: string[] }> }
) {
  return handleRoute(req, context);
}
