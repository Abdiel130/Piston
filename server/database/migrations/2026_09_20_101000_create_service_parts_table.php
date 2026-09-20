<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Las refacciones de cada servicio. Aquí vive el valor real del "histórico del
 * auto": saber que el filtro era OEM y no genérico es lo que sostiene el
 * expediente cuando vendes el vehículo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_parts', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('service_record_id')->constrained()->cascadeOnDelete();

            $table->string('name', 140);
            $table->string('brand', 80)->nullable();
            $table->string('part_number', 80)->nullable();
            $table->decimal('quantity', 8, 2)->default(1);
            $table->string('unit', 20)->default('pza');
            $table->decimal('unit_cost', 10, 2)->default(0);

            // El dato se captura desde ahora; la ALERTA de garantía quedó
            // fuera del alcance acordado.
            $table->smallInteger('warranty_months')->nullable();
            $table->integer('warranty_km')->nullable();

            $table->pistonSync();

            $table->index('service_record_id');
            $table->index('part_number');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_parts');
    }
};
