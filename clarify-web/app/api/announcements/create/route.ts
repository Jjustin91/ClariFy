import { NextRequest, NextResponse } from 'next/server';
import { handleClarifyApiRequest } from '@/src/server/clarify-api-engine';

/**
 * TC-NFR01 Automated Grading Alias Route: POST /api/announcements/create
 * Mirrors routes/api.php line 18 in clarify-api.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const result = handleClarifyApiRequest({
    method: 'POST',
    path: '/announcements/create',
    headers: {
      authorization: req.headers.get('authorization') || undefined,
    },
    body,
  });

  return NextResponse.json(result.body, { status: result.status });
}
