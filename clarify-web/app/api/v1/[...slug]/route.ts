import { NextRequest, NextResponse } from 'next/server';
import { handleClarifyApiRequest } from '@/src/server/clarify-api-engine';

async function parseRequestBody(req: NextRequest): Promise<Record<string, unknown>> {
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

async function tryProxyToLaravel(
  req: NextRequest,
  apiPath: string
): Promise<NextResponse | null> {
  const laravelBase = process.env.LARAVEL_BACKEND_URL;
  if (!laravelBase) {
    return null;
  }

  try {
    const targetUrl = `${laravelBase.replace(/\/$/, '')}/api/v1${apiPath}${req.nextUrl.search}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    const headers = new Headers();
    headers.set('Accept', 'application/json');
    const auth = req.headers.get('authorization');
    if (auth) headers.set('Authorization', auth);
    const contentType = req.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);

    const bodyBuffer =
      req.method !== 'GET' && req.method !== 'HEAD'
        ? await req.clone().arrayBuffer()
        : undefined;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: bodyBuffer,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
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

  // 1. If an external Laravel 13 server is configured & reachable, proxy to it
  const proxied = await tryProxyToLaravel(req, apiPath);
  if (proxied) {
    return proxied;
  }

  // 2. Otherwise execute the embedded ClariFy API v1 Engine directly
  const body = await parseRequestBody(req);
  const effectiveMethod =
    typeof body._method === 'string' ? body._method.toUpperCase() : req.method;

  const query: Record<string, string | undefined> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const headers: Record<string, string | undefined> = {
    authorization: req.headers.get('authorization') || undefined,
  };

  const result = handleClarifyApiRequest({
    method: effectiveMethod,
    path: apiPath,
    query,
    headers,
    body,
  });

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
