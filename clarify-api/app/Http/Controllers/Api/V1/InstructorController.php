<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Resources\InstructorResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InstructorController
{
    /**
     * GET /api/v1/instructors (Verified Faculty Directory — Wireframes pp. 3 & 6)
     */
    public function index(Request $request): JsonResponse
    {
        $query = User::with('academicProfile')
            ->whereIn('role', ['faculty', 'dept_head'])
            ->where('verification_status', 'approved');

        if ($department = $request->query('department')) {
            if (strtoupper($department) !== 'ALL') {
                $query->whereHas('academicProfile', function ($q) use ($department) {
                    $q->where('department', strtoupper($department));
                });
            }
        }

        $likeOp = \Illuminate\Support\Facades\DB::getDriverName() === 'pgsql' ? 'ilike' : 'like';

        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search, $likeOp) {
                $q->where('name', $likeOp, "%{$search}%")
                    ->orWhereHas('academicProfile', function ($pq) use ($search, $likeOp) {
                        $pq->where('department', $likeOp, "%{$search}%")
                            ->orWhere('specialization', $likeOp, "%{$search}%");
                    });
            });
        }

        if ($request->query('sort') === 'department') {
            $query->orderBy(
                \App\Models\AcademicProfile::select('department')
                    ->whereColumn('academic_profiles.user_id', 'users.id')
                    ->limit(1)
            )->orderBy('name');
        } else {
            $query->orderBy('name');
        }

        $perPage = max(1, (int) $request->query('per_page', 6));
        $page = max(1, (int) $request->query('page', 1));
        $paginator = $query->paginate($perPage, ['*'], 'page', $page);
        if ($paginator->lastPage() > 0 && $page > $paginator->lastPage()) {
            $paginator = $query->paginate($perPage, ['*'], 'page', $paginator->lastPage());
        }

        return response()->json([
            'data' => InstructorResource::collection($paginator->items()),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => max(1, $paginator->lastPage()),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }
}
