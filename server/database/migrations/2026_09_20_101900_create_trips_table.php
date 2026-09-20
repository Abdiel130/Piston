<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trips', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->timestampTz('started_at');
            $table->timestampTz('ended_at')->nullable();
            $table->integer('start_odometer_km')->nullable();
            $table->integer('end_odometer_km')->nullable();
            $table->integer('distance_km')->nullable();
            $table->string('origin', 160)->nullable();
            $table->string('destination', 160)->nullable();
            $table->enum('purpose', ['personal', 'work', 'mixed', 'other'])->default('personal');
            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['vehicle_id', 'started_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trips');
    }
};
