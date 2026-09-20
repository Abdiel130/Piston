<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Historial de precios por estación y tipo de combustible.
 *
 * Se alimenta solo: cada carga con precio genera una fila con
 * source = from_fuel_entry. La capa comunitaria (votos, reputación) se añade
 * después agregando tablas, sin tocar esta.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_station_prices', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('station_id')->constrained('fuel_stations')->cascadeOnDelete();

            $table->enum('fuel_grade', ['regular', 'premium', 'diesel']);
            $table->decimal('price', 8, 3);
            // Timestamp real. El "hace 18 minutos" se calcula en la vista.
            $table->timestampTz('observed_at');
            $table->enum('source', ['self_reported', 'from_fuel_entry', 'imported'])->default('self_reported');
            $table->foreignUuid('fuel_entry_id')->nullable()->constrained('fuel_entries')->nullOnDelete();

            $table->pistonSync();

            $table->index(['station_id', 'fuel_grade', 'observed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_station_prices');
    }
};
