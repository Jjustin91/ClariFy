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
      for (const [key, value] of formData.entries()) {
        if (typeof value === 'string') {
          obj[key] = value;
        } else if (
          value &&
          typeof value === 'object' &&
          'name' in value &&
          'arrayBuffer' in value
        ) {
          const fileObj = value as File;
          obj[key] = fileObj.name;
          if (!obj.attachment_name) {
            obj.attachment_name = fileObj.name;
          }
          if (!obj.attachment_type && fileObj.type) {
            obj.attachment_type = fileObj.type.startsWith('image/')
              ? 'image'
              : 'document';
          }
          if (!obj.attachment_url && fileObj.size > 0) {
            const ab = await fileObj.arrayBuffer();
            const b64 = Buffer.from(ab).toString('base64');
            const mime = fileObj.type || 'application/octet-stream';
            obj.attachment_url = `data:${mime};base64,${b64}`;
          }
        }
      }
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
  body: Record<string, unknown>,
  responseBody: Record<string, unknown>
): {
  type: RealtimeEvent['type'];
  channel_id?: number;
  announcement?: RealtimeEvent['announcement'];
  message?: RealtimeEvent['message'];
  thread?: RealtimeEvent['thread'];
} | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return null;

  const data = (responseBody?.data || undefined) as
    | Record<string, unknown>
    | undefined;

  if (apiPath === '/announcements' || apiPath === '/announcements/create') {
    const isUrgent = Boolean(data?.is_urgent || body.is_urgent === true || body.is_urgent === 'true');
    return {
      type: isUrgent ? 'announcement.urgent' : 'announcement.created',
      channel_id: Number(data?.channel_id || body.channel_id || 1),
      announcement: data as unknown as RealtimeEvent['announcement'],
    };
  }
  if (/^\/announcements\/\d+\/acknowledge$/.test(apiPath)) {
    return {
      type: 'announcement.acknowledged',
      channel_id: data?.channel_id ? Number(data.channel_id) : undefined,
      announcement: data as unknown as RealtimeEvent['announcement'],
    };
  }
  if (/^\/announcements\/\d+$/.test(apiPath)) {
    if (m === 'DELETE') {
      return { type: 'announcement.deleted' };
    }
    const isUrgent = Boolean(data?.is_urgent || body.is_urgent === true);
    return {
      type: isUrgent ? 'announcement.urgent' : 'announcement.updated',
      channel_id: data?.channel_id ? Number(data.channel_id) : undefined,
      announcement: data as unknown as RealtimeEvent['announcement'],
    };
  }
  const chatMatch = apiPath.match(/^\/channels\/(\d+)\/chat$/);
  if (chatMatch) {
    return {
      type: 'chat.message',
      channel_id: Number(chatMatch[1]),
      message: data as unknown as RealtimeEvent['message'],
    };
  }
  const threadCreateMatch = apiPath.match(/^\/channels\/(\d+)\/threads$/);
  if (threadCreateMatch) {
    return {
      type: 'thread.created',
      channel_id: Number(threadCreateMatch[1]),
      thread: data as unknown as RealtimeEvent['thread'],
    };
  }
  if (/^\/threads\/\d+\/replies$/.test(apiPath)) {
    return {
      type: 'thread.replied',
      channel_id: data?.channel_id ? Number(data.channel_id) : undefined,
      thread: data as unknown as RealtimeEvent['thread'],
    };
  }
  if (/^\/threads\/\d+\/convert-faq$/.test(apiPath)) {
    return {
      type: 'thread.faq_pinned',
      channel_id: data?.channel_id ? Number(data.channel_id) : undefined,
      thread: data as unknown as RealtimeEvent['thread'],
    };
  }
  if (/^\/threads\/\d+$/.test(apiPath)) {
    return {
      type: m === 'DELETE' ? 'thread.deleted' : 'thread.updated',
      channel_id: data?.channel_id ? Number(data.channel_id) : undefined,
      thread: data as unknown as RealtimeEvent['thread'],
    };
  }
  if (apiPath === '/channels') {
    return { type: 'channel.created' };
  }
  if (/^\/channels\/\d+\/(join|members)$/.test(apiPath)) {
    return { type: 'channel.updated' };
  }
  if (
    apiPath.startsWith('/admin/') ||
    apiPath === '/profile' ||
    apiPath === '/auth/register'
  ) {
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
  const rawBase =
    process.env.LARAVEL_BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    'https://api.ustpclarify.tech';
  const laravelBase = rawBase.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
  if (!laravelBase) return null;

  const qs = searchParams.toString();
  const targetUrl = `${laravelBase}/api/v1${apiPath}${
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
    const ev = classifyMutationEvent(
      effectiveMethod,
      apiPath,
      body,
      result.body
    );
    if (ev) {
      emitRealtimeEvent(ev.type, {
        channel_id: ev.channel_id,
        announcement: ev.announcement,
        message: ev.message,
        thread: ev.thread,
      });
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
