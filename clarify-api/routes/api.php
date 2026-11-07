<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\ChannelController;
use App\Http\Controllers\Api\V1\ChannelChatController;
use App\Http\Controllers\Api\V1\AnnouncementController;
use App\Http\Controllers\Api\V1\ThreadController;
use App\Http\Controllers\Api\V1\InstructorController;
use App\Http\Controllers\Api\V1\AccountController;
use App\Http\Controllers\Api\V1\DeviceTokenController;

/*
|--------------------------------------------------------------------------
| ClariFy REST API v1 Routes (/api/v1/...)
|--------------------------------------------------------------------------
*/
Route::prefix('v1')->group(function () {

    // Public Status & Health Check (Must be accessible before login)
    Route::get('/persistence/status', function () {
        return response()->json([
            'status' => 'connected',
            'database' => config('database.connections.pgsql.database', 'PostgreSQL'),
            'timestamp' => now()->toISOString(),
            'data' => [
                'driver' => 'laravel-postgresql',
                'database' => config('database.connections.pgsql.database', 'clarify'),
                'host' => config('database.connections.pgsql.host', '127.0.0.1'),
                'connected' => true,
                'revision' => now()->timestamp,
            ],
        ]);
    });

    // Public Auth Routes
    Route::post('/auth/login', [AuthController::class, 'login']);
    Route::post('/auth/register', [AuthController::class, 'register']);

    // Authenticated & Registrar-Verified Routes
    Route::middleware(['auth:sanctum', 'verified.account'])->group(function () {

        // Auth & Profile
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::match(['post', 'patch'], '/profile', [ProfileController::class, 'update']);

        // Scoped Channels & Roster
        Route::get('/channels', [ChannelController::class, 'index']);
        Route::post('/channels', [ChannelController::class, 'store']);
        Route::match(['post', 'patch', 'put'], '/channels/{id}', [ChannelController::class, 'update']);
        Route::delete('/channels/{id}', [ChannelController::class, 'destroy']);
        Route::post('/channels/{id}/join', [ChannelController::class, 'join']);
        Route::post('/channels/{id}/leave', [ChannelController::class, 'leave']);
        Route::post('/channels/{id}/members', [ChannelController::class, 'manageMembers']);

        // Course Hub Messenger Chat (/messages & /chat aliases)
        Route::get('/channels/{channelId}/messages', [ChannelChatController::class, 'index']);
        Route::post('/channels/{channelId}/messages', [ChannelChatController::class, 'store']);
        Route::get('/channels/{channelId}/chat', [ChannelChatController::class, 'index']);
        Route::post('/channels/{channelId}/chat', [ChannelChatController::class, 'store']);

        // Scoped Announcements, Read Reach & Audits
        Route::get('/announcements', [AnnouncementController::class, 'index']);
        Route::post('/announcements', [AnnouncementController::class, 'store']);
        Route::match(['post', 'patch'], '/announcements/{id}', [AnnouncementController::class, 'update']);
        Route::delete('/announcements/{id}', [AnnouncementController::class, 'destroy']);
        Route::post('/announcements/{id}/acknowledge', [AnnouncementController::class, 'acknowledge']);

        // Isolated Q&A Threads, 1-Click FAQs & Instructor Directory
        Route::get('/channels/{channelId}/threads', [ThreadController::class, 'index']);
        Route::post('/channels/{channelId}/threads', [ThreadController::class, 'store']);
        Route::patch('/threads/{threadId}', [ThreadController::class, 'update']);
        Route::delete('/threads/{threadId}', [ThreadController::class, 'destroy']);
        Route::post('/threads/{threadId}/replies', [ThreadController::class, 'reply']);
        Route::post('/threads/{threadId}/convert-faq', [ThreadController::class, 'convertToFaq']);
        Route::get('/instructors', [InstructorController::class, 'index']);

        // IT Admin Console & Mobile Push Tokens
        Route::get('/admin/users/pending', [AccountController::class, 'pendingUsers']);
        Route::patch('/admin/users/{userId}/verify', [AccountController::class, 'verifyUser']);
        Route::get('/admin/users', [AccountController::class, 'index']);
        Route::patch('/admin/users/{userId}/role', [AccountController::class, 'updateRole']);
        Route::post('/admin/sync-prisms', [AccountController::class, 'syncPrisms']);
        Route::get('/admin/metrics', [AccountController::class, 'metrics']);
        Route::post('/devices/tokens', [DeviceTokenController::class, 'store']);
    });
});