<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class EnsureAccountVerified
{
    public function handle(Request $request, Closure $next)
    {
        // TODO: Implement middleware check
        return $next($request);
    }
}
