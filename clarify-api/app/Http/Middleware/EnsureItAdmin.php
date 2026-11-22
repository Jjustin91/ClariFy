<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureItAdmin
{
    /**
     * Restrict IT Admin Console routes strictly to authenticated IT Administrator accounts.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || $user->role !== 'it_admin') {
            return response()->json([
                'status' => 403,
                'message' => 'HTTP 403 Forbidden: IT Administrator privileges are required.',
            ], 403);
        }

        return $next($request);
    }
}
