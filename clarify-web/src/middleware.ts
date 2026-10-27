import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  // TODO [FE-1]: Implement role-based route protection
  return NextResponse.next();
}
