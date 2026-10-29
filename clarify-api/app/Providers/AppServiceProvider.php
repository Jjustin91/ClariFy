<?php

namespace App\Providers;

use App\Models\Announcement;
use App\Observers\AnnouncementObserver;
use App\Policies\AnnouncementPolicy;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        JsonResource::withoutWrapping();

        // Register Immutable Audit Observer (NFR-03_REV)
        Announcement::observe(AnnouncementObserver::class);

        // Register RBAC Announcement Policy (FR-02, FR-04_REV, NFR-01_REV)
        Gate::policy(Announcement::class, AnnouncementPolicy::class);
    }
}
