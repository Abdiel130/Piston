<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Un solo motor de alertas para servicios y documentos. Unificarlos evita dos
 * bandejas distintas en la UI y dos cron jobs que hacen lo mismo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reminders', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->enum('kind', ['service', 'document', 'custom']);
            // FK lógica: maintenance_schedule_id o document_id según `kind`.
            $table->uuid('source_id')->nullable();

            $table->string('title', 160);
            $table->date('due_date')->nullable();
            $table->integer('due_odometer_km')->nullable();
            $table->smallInteger('notify_days_before')->default(15);
            $table->integer('notify_km_before')->default(500);
            $table->enum('status', ['pending', 'notified', 'done', 'dismissed'])->default('pending');
            $table->timestampTz('last_notified_at')->nullable();

            $table->pistonSync();

            $table->index(['user_id', 'status', 'due_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reminders');
    }
};
