<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Qué servicios cubrió una visita. Un cambio de aceite más una rotación de
 * llantas son UNA visita con DOS ítems.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_record_items', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('service_record_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('service_type_id')->constrained()->restrictOnDelete();

            $table->string('description', 200)->nullable();
            $table->decimal('cost', 10, 2)->nullable();

            $table->pistonSync();

            $table->index('service_record_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_record_items');
    }
};
