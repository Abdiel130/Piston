<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * La curva real del indicador de combustible, por vehículo.
 *
 * El error clásico es asumir que la aguja es lineal y calcular
 * (rayitas / total) * capacidad. No lo es: en casi todos los autos la primera
 * rayita dura mucho más que la última, y esa no-linealidad es justo lo que
 * arruina el km/L estimado.
 *
 * Al dar de alta un vehículo se siembran puntos lineales (default_linear).
 * Cada carga a tanque lleno desde N rayitas produce una medición real de
 * cuántos litros había en N, y ese punto pasa a user_measured. La app se
 * auto-calibra con el uso.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gauge_calibration_points', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            // Decimal para permitir medias rayitas ("entre la 2 y la 3").
            $table->decimal('segment', 5, 2);
            $table->decimal('liters', 6, 2);
            $table->enum('source', ['default_linear', 'user_measured', 'manual'])->default('default_linear');
            $table->timestampTz('measured_at')->nullable();
            $table->smallInteger('sample_count')->default(0);

            $table->pistonSync();

            $table->unique(['vehicle_id', 'segment']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gauge_calibration_points');
    }
};
