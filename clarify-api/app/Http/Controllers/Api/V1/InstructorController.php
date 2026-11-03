<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\InstructorResource;
use App\Models\User;
use App\Support\ApiCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class InstructorController
{
    /**
     * GET /api/v1/instructors (Verified Faculty Directory — Wireframes pp. 3 & 6)
     * Caches the verified instructor directory for 30 minutes (1800s) using the 'file' cache store.
     */
    public function index(Request $request): JsonResponse
    {
        $department = $request->query('department');
        $search = trim((string) $request->query('search', ''));
        $sort = (string) $request->query('sort', 'name');
        $perPage = max(1, (int) $request->query('per_page', 6));
        $page = max(1, (int) $request->query('page', 1));

        $cacheParams = array_filter([
            'department' => $department,
            'search' => $search,
            'sort' => $sort,
            'per_page' => $perPage,
            'page' => $page,
        ], fn ($value) => $value !== null && $value !== '');

        $cacheKey = ApiCache::instructorsKey($cacheParams);

        $payload = Cache::remember($cacheKey, ApiCache::INSTRUCTORS_TTL_SECONDS, function () use (
            $request,
            $department,
            $search,
            $sort,
            $perPage,
            $page
        ): array {
            $query = User::with('academicProfile')
                ->whereIn('role', ['faculty', 'dept_head'])
                ->where('verification_status', 'approved');

            if ($department && strtoupper((string) $department) !== 'ALL') {
                $query->whereHas('academicProfile', function ($q) use ($department) {
                    $q->where('department', strtoupper((string) $department));
                });
            }

            $likeOp = \Illuminate\Support\Facades\DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

            if ($search !== '') {
                $query->where(function ($q) use ($search, $likeOp) {
                    $q->where('name', $likeOp, "%{$search}%")
                        ->orWhereHas('academicProfile', function ($pq) use ($search, $likeOp) {
                            $pq->where('department', $likeOp, "%{$search}%")
                                ->orWhere('specialization', $likeOp, "%{$search}%");
                        });
                });
            }

            if ($sort === 'department') {
                $query->orderBy(
                    \App\Models\AcademicProfile::select('department')
                        ->whereColumn('academic_profiles.user_id', 'users.id')
                        ->limit(1)
                )->orderBy('name');
            } else {
                $query->orderBy('name');
            }

            $paginator = $query->paginate($perPage, ['*'], 'page', $page);
            if ($paginator->lastPage() > 0 && $page > $paginator->lastPage()) {
                $paginator = $query->paginate($perPage, ['*'], 'page', $paginator->lastPage());
            }

            return [
                'data' => InstructorResource::collection($paginator->items())->resolve($request),
                'meta' => [
                    'current_page' => $paginator->currentPage(),
                    'last_page' => max(1, $paginator->lastPage()),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                ],
            ];
        });

        return response()->json($payload);
    }
}
