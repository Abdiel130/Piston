<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * El odómetro es una serie temporal, no un campo del vehículo.
 *
 * Así la distancia entre dos cargas sigue siendo calculable, se detectan
 * lecturas imposibles (retrocesos, saltos) y se puede reconstruir la línea de
 * tiempo aunque los eventos se capturen desordenados, que offline pasa todo el
 * tiempo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('odometer_readings', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->timestampTz('read_at');
            $table->integer('km');
            $table->enum('source', ['manual', 'fuel', 'service', 'trip', 'expense', 'document']);

            // FK lógica al evento que la originó. Sin constraint porque apunta
            // a tablas distintas según `source`.
            $table->uuid('source_id')->nullable();

            $table->boolean('is_suspect')->default(false);

            $table->pistonSync();

            $table->index(['vehicle_id', 'read_at']);
            $table->index(['vehicle_id', 'km']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('odometer_readings');
    }
};
