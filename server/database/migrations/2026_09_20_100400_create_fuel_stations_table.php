<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_stations', function (Blueprint $table) {
            $table->pistonKey();
            // NULL = estación del catálogo del sistema, compartida.
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();

            $table->string('brand', 60)->nullable();
            $table->string('name', 120);
            $table->string('address', 200)->nullable();
            $table->string('city', 80)->nullable();
            $table->string('state', 80)->nullable();
            $table->decimal('latitude', 9, 6)->nullable();
            $table->decimal('longitude', 9, 6)->nullable();

            // Id de la CRE, para un futuro import de precios oficiales.
            $table->string('external_ref', 60)->nullable();
            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['latitude', 'longitude']);
            $table->index('external_ref');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_stations');
    }
};
