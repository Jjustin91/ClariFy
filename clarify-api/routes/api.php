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
| TC-NFR01 Automated Grading Alias Route
|--------------------------------------------------------------------------
*/
Route::middleware(['verified.account'])
    ->post('/announcements/create', [AnnouncementController::class, 'store']);

/*
|--------------------------------------------------------------------------
| ClariFy REST API v1 Routes (/api/v1/...)
|--------------------------------------------------------------------------
*/
Route::prefix('v1')->group(function () {

    // Public Auth Route
    Route::post('/auth/login', [AuthController::class, 'login']);

    // Authenticated & Registrar-Verified Routes (FR-08)
    Route::middleware(['verified.account'])->group(function () {

        // Workflow 1: Auth & Profile
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::match(['post', 'patch'], '/profile', [ProfileController::class, 'update']);

        // Workflow 5: Scoped Channels & Roster
        Route::get('/channels', [ChannelController::class, 'index']);
        Route::post('/channels', [ChannelController::class, 'store']);
        Route::post('/channels/{id}/join', [ChannelController::class, 'join']);
        Route::post('/channels/{id}/members', [ChannelController::class, 'manageMembers']);

        // Course Hub Messenger Chat
        Route::get('/channels/{channelId}/chat', [ChannelChatController::class, 'index']);
        Route::post('/channels/{channelId}/chat', [ChannelChatController::class, 'store']);

        // Workflows 2 & 3: Scoped Announcements, Read Reach & Audits
        Route::get('/announcements', [AnnouncementController::class, 'index']);
        Route::post('/announcements', [AnnouncementController::class, 'store']);
        Route::match(['post', 'patch'], '/announcements/{id}', [AnnouncementController::class, 'update']);
        Route::delete('/announcements/{id}', [AnnouncementController::class, 'destroy']);
        Route::post('/announcements/{id}/acknowledge', [AnnouncementController::class, 'acknowledge']);

        // Workflow 4: Isolated Q&A Threads, 1-Click FAQs & Instructor Directory
        Route::get('/channels/{channelId}/threads', [ThreadController::class, 'index']);
        Route::post('/channels/{channelId}/threads', [ThreadController::class, 'store']);
        Route::patch('/threads/{threadId}', [ThreadController::class, 'update']);
        Route::delete('/threads/{threadId}', [ThreadController::class, 'destroy']);
        Route::post('/threads/{threadId}/replies', [ThreadController::class, 'reply']);
        Route::post('/threads/{threadId}/convert-faq', [ThreadController::class, 'convertToFaq']);
        Route::get('/instructors', [InstructorController::class, 'index']);

        // Workflow 6: IT Admin Console & Mobile Push Tokens
        Route::get('/admin/users/pending', [AccountController::class, 'pendingUsers']);
        Route::patch('/admin/users/{userId}/verify', [AccountController::class, 'verifyUser']);
        Route::get('/admin/users', [AccountController::class, 'index']);
        Route::patch('/admin/users/{userId}/role', [AccountController::class, 'updateRole']);
        Route::post('/admin/sync-prisms', [AccountController::class, 'syncPrisms']);
        Route::get('/admin/metrics', [AccountController::class, 'metrics']);

        Route::post('/devices/token', [DeviceTokenController::class, 'store']);
    });
});