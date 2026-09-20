<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();

            $table->string('nickname', 60)->nullable();
            $table->string('make', 60);
            $table->string('model', 80);
            $table->smallInteger('year');
            $table->string('trim', 80)->nullable();
            $table->enum('vehicle_type', ['car', 'motorcycle', 'pickup', 'truck', 'van'])->default('car');
            $table->enum('transmission', ['manual', 'automatic', 'cvt', 'dsg'])->nullable();
            $table->decimal('engine_displacement_l', 4, 1)->nullable();
            $table->string('color', 40)->nullable();
            $table->string('vin', 17)->nullable();
            $table->string('license_plate', 15)->nullable();

            // Trámites MX: la terminación de placa y el engomado determinan
            // el calendario de verificación.
            $table->smallInteger('plate_last_digit')->nullable();
            $table->enum('emissions_sticker', ['yellow', 'pink', 'red', 'green', 'blue', 'none'])->default('none');

            // Specs que alimentan los cálculos de combustible y mantenimiento.
            $table->enum('default_fuel_grade', ['regular', 'premium', 'diesel'])->default('regular');
            $table->decimal('tank_capacity_l', 6, 2);
            $table->smallInteger('gauge_total_segments')->default(8);
            $table->decimal('factory_km_per_liter', 5, 2)->nullable();
            $table->decimal('oil_capacity_l', 4, 2)->nullable();
            $table->string('oil_spec', 40)->nullable();
            $table->smallInteger('tire_pressure_front_psi')->nullable();
            $table->smallInteger('tire_pressure_rear_psi')->nullable();

            // Caché de MAX(odometer_readings.km): evita un agregado en cada
            // render del dashboard. La fuente de verdad es odometer_readings.
            $table->integer('current_odometer_km')->default(0);

            $table->date('purchase_date')->nullable();
            $table->decimal('purchase_price', 12, 2)->nullable();
            $table->integer('purchase_odometer_km')->nullable();
            $table->date('sale_date')->nullable();
            $table->decimal('sale_price', 12, 2)->nullable();
            $table->integer('sale_odometer_km')->nullable();

            // archived/sold conservan todo su histórico.
            $table->enum('status', ['active', 'archived', 'sold'])->default('active');
            $table->boolean('is_primary')->default(false);
            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['user_id', 'status']);
            $table->index(['user_id', 'deleted_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicles');
    }
};
