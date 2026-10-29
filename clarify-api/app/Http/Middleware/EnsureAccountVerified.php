<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAccountVerified
{
    /**
     * Blocks unverified or rejected accounts from accessing authenticated endpoints (FR-08 / TC-FR08).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json([
                'status' => 401,
                'message' => 'Your session has expired. Please log in again.',
            ], 401);
        }

        if ($user->verification_status !== 'approved') {
            return response()->json([
                'status' => 403,
                'verification_status' => $user->verification_status,
                'message' => 'Your account is pending IT Administrator registrar verification (FR-08).',
            ], 403);
        }

        return $next($request);
    }
}
