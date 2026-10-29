<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class ClarifyDemoSeeder extends Seeder
{
    public function run(): void
    {
        // Run the main seeder logic if defined in DatabaseSeeder
        $this->call(DatabaseSeeder::class);

        // Reset PostgreSQL sequences so new inserts don't collide with explicit seeded IDs
        if (DB::getDriverName() === 'pgsql') {
            $tables = [
                'users',
                'academic_profiles',
                'channels',
                'channel_user',
                'announcements',
                'announcement_reads',
                'announcement_audits',
                'messages',
                'prisms_sync_logs',
                'device_tokens',
            ];

            foreach ($tables as $table) {
                DB::statement("SELECT setval(pg_get_serial_sequence('{$table}', 'id'), COALESCE((SELECT MAX(id) FROM {$table}), 1), true);");
            }
        }
    }
}