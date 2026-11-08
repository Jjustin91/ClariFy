import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'txt',
]);

const FORBIDDEN_ATTACHMENT_MIMES = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'application/x-httpd-php',
  'application/x-php',
  'text/x-php',
]);

async function parseRequestBody(
  req: NextRequest,
  apiPath: string
): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return {};
  }

  const contentType = req.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const obj: Record<string, unknown> = {};
      let uploadedAttachmentFile: File | null = null;

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
          if (key === 'attachment') {
            uploadedAttachmentFile = fileObj;
          } else {
            obj[key] = fileObj.name;
          }
        }
      }

      if (uploadedAttachmentFile && uploadedAttachmentFile.size > 0) {
        if (uploadedAttachmentFile.size > 10 * 1024 * 1024) {
          obj._attachment_error =
            'The attachment field must not be greater than 10240 kilobytes.';
          return obj;
        }

        const origName = uploadedAttachmentFile.name || 'attachment';
        const ext = origName.includes('.')
          ? origName.split('.').pop()!.toLowerCase()
          : '';
        const mime = (uploadedAttachmentFile.type || '').toLowerCase();

        if (
          !ALLOWED_ATTACHMENT_EXTENSIONS.has(ext) ||
          FORBIDDEN_ATTACHMENT_MIMES.has(mime)
        ) {
          obj._attachment_error =
            'The attachment must be a file of type: jpg, jpeg, png, webp, gif, pdf, doc, docx, ppt, pptx, xls, xlsx, txt.';
          return obj;
        }

        const isImage =
          mime.startsWith('image/') ||
          ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
        const isPdf = mime === 'application/pdf' || ext === 'pdf';

        const annMatch = apiPath.match(/^\/announcements\/(\d+)$/);
        const channelFolder = Number(
          obj.channel_id || (annMatch ? annMatch[1] : 0) || 0
        );
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const relDir = path.posix.join(
          'storage',
          'announcements',
          String(channelFolder)
        );
        const absDir = path.join(process.cwd(), 'public', relDir);
        await fs.mkdir(absDir, { recursive: true });
        const ab = await uploadedAttachmentFile.arrayBuffer();
        await fs.writeFile(path.join(absDir, fileName), Buffer.from(ab));

        obj.attachment_url = `/${relDir}/${fileName}`;
        obj.attachment_name = origName;
        obj.attachment_type = isImage ? 'image' : isPdf ? 'pdf' : 'document';
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
  target_user_id?: number;
  action?: RealtimeEvent['action'];
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
  const joinOrMembersMatch = apiPath.match(/^\/channels\/(\d+)\/(join|members)$/);
  if (joinOrMembersMatch) {
    const channelId = Number(joinOrMembersMatch[1]);
    const subRoute = joinOrMembersMatch[2];
    const rawAction = String(body.action || '');
    let action: RealtimeEvent['action'] = 'requested';
    if (subRoute === 'members') {
      if (rawAction === 'approve') action = 'approved';
      else if (rawAction === 'reject') action = 'rejected';
      else if (rawAction === 'remove') action = 'removed';
      else action = 'added';
    }
    const targetUserId =
      typeof responseBody?.target_user_id === 'number'
        ? responseBody.target_user_id
        : undefined;
    return {
      type: 'membership.changed',
      channel_id: channelId,
      target_user_id: targetUserId,
      action,
    };
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
      },
      body:
        method === 'GET' || method === 'HEAD'
          ? undefined
          : JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status >= 500) {
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

  const body = await parseRequestBody(req, apiPath);
  if (typeof body._attachment_error === 'string' && body._attachment_error) {
    return NextResponse.json(
      {
        status: 422,
        message: body._attachment_error,
        errors: {
          attachment: [body._attachment_error],
        },
      },
      { status: 422 }
    );
  }
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

  const headers: Record<string, string | undefined> = {
    authorization: authHeader,
  };

  // 1. Proxy to Laravel Backend first so all Sanctum auth & ChannelPolicy rules apply authoritatively
  let result = await tryProxyToLaravel(
    effectiveMethod,
    apiPath,
    req.nextUrl.searchParams,
    headers,
    body
  );

  // 2. Fallback to direct PostgreSQL adapter when local Laravel daemon is not running
  if (!result) {
    result = await handlePostgresApiRequest({
      method: effectiveMethod,
      path: apiPath,
      query,
      headers,
      body,
    });
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
        target_user_id: ev.target_user_id,
        action: ev.action,
        announcement: ev.announcement,
        message: ev.message,
        thread: ev.thread,
      });
      if (ev.type === 'membership.changed') {
        emitRealtimeEvent('channel.updated', {
          channel_id: ev.channel_id,
        });
      }
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
