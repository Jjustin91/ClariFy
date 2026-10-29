<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Gate;
use App\Models\Announcement;
use App\Observers\AnnouncementObserver;
use App\Policies\AnnouncementPolicy;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Announcement::observe(AnnouncementObserver::class);
        Gate::policy(Announcement::class, AnnouncementPolicy::class);
    }
}