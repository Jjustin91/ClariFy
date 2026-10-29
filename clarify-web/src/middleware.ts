import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

  // Protect dashboard, messages, and announcements routes
  if (!token && (pathname.startsWith('/dashboard') || pathname.startsWith('/messages') || pathname.startsWith('/announcements'))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect to dashboard if logged-in user visits /login
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/messages/:path*', '/announcements/:path*', '/login'],
};