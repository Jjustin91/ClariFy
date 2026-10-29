<?php

namespace App\Http\Middleware;

use App\Models\Channel;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnforceChannelScope
{
    /**
     * Enforces CITC/CEA/Course Hub boundaries (FR-01_REV).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $channelParam = $request->route('channel') ?? $request->route('id');

        if (! $user || ! $channelParam) {
            return $next($request);
        }

        $channel = $channelParam instanceof Channel
            ? $channelParam
            : Channel::find($channelParam);

        if (! $channel) {
            return response()->json([
                'status' => 404,
                'message' => 'Requested Course Hub channel does not exist.',
            ], 404);
        }

        if (in_array($user->role, ['it_admin', 'dept_head'], true)) {
            return $next($request);
        }

        $userDept = $user->academicProfile?->department;
        if (
            $channel->scope_department &&
            $userDept &&
            strcasecmp($channel->scope_department, $userDept) !== 0 &&
            ! $channel->members()->where('users.id', $user->id)->exists()
        ) {
            return response()->json([
                'status' => 403,
                'message' => "Access Denied: You are outside the {$channel->scope_department} channel scope (FR-01_REV).",
            ], 403);
        }

        return $next($request);
    }
}
