<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Diario de diagnóstico. El síntoma se registra ANTES de saber qué lo causa:
 * "ruido metálico al frenar en reversa" es un dato útil aunque todavía no haya
 * un servicio asociado.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('issues', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->string('title', 160);
            $table->text('description')->nullable();
            $table->enum('severity', ['low', 'medium', 'high', 'critical'])->default('low');
            $table->enum('status', ['open', 'monitoring', 'resolved', 'dismissed'])->default('open');

            $table->date('noticed_at');
            $table->integer('noticed_odometer_km')->nullable();
            $table->date('resolved_at')->nullable();
            $table->integer('resolved_odometer_km')->nullable();

            $table->pistonSync();

            $table->index(['vehicle_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('issues');
    }
};
