<?php

namespace App\Providers;

use App\Models\Announcement;
use App\Models\Channel;
use App\Observers\AnnouncementObserver;
use App\Policies\AnnouncementPolicy;
use App\Policies\ChannelPolicy;
use App\Services\Sms\SmsManager;
use App\Services\Sms\SmsProviderInterface;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(SmsProviderInterface::class, fn (): SmsProviderInterface => SmsManager::resolve());
    }

    public function boot(): void
    {
        Announcement::observe(AnnouncementObserver::class);
        Gate::policy(Announcement::class, AnnouncementPolicy::class);
        Gate::policy(Channel::class, ChannelPolicy::class);
    }
}