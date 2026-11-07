<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class EnsureAccountVerified
{
    /**
     * Resolves Sanctum-authenticated user and blocks unverified accounts (FR-08 / TC-FR08).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = Auth::guard('sanctum')->user() ?? $request->user();

        if (! $user) {
            return response()->json([
                'status' => 401,
                'message' => 'Your session has expired. Please log in again.',
            ], 401);
        }

        Auth::setUser($user);
        $request->setUserResolver(fn () => $user);

        if ($user->verification_status !== 'approved') {
            return response()->json([
                'status' => 403,
                'verification_status' => $user->verification_status,
                'message' => 'Your account is pending IT Administrator registrar verification.',
            ], 403);
        }

        return $next($request);
    }
}

