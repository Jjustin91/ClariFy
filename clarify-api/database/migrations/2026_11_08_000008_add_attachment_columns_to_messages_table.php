<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('messages')) {
            return;
        }

        Schema::table('messages', function (Blueprint $table): void {
            if (! Schema::hasColumn('messages', 'attachment_url')) {
                $table->text('attachment_url')->nullable()->after('content');
            }
            if (! Schema::hasColumn('messages', 'attachment_name')) {
                $table->string('attachment_name')->nullable()->after('attachment_url');
            }
            if (! Schema::hasColumn('messages', 'attachment_type')) {
                $table->string('attachment_type', 32)->nullable()->after('attachment_name');
            }
            if (! Schema::hasColumn('messages', 'attachment_mime')) {
                $table->string('attachment_mime', 128)->nullable()->after('attachment_type');
            }
            if (! Schema::hasColumn('messages', 'attachment_size')) {
                $table->unsignedBigInteger('attachment_size')->nullable()->after('attachment_mime');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('messages')) {
            return;
        }

        Schema::table('messages', function (Blueprint $table): void {
            $columnsToDrop = [];
            foreach ([
                'attachment_size',
                'attachment_mime',
                'attachment_type',
                'attachment_name',
                'attachment_url',
            ] as $column) {
                if (Schema::hasColumn('messages', $column)) {
                    $columnsToDrop[] = $column;
                }
            }

            if ($columnsToDrop !== []) {
                $table->dropColumn($columnsToDrop);
            }
        });
    }
};
