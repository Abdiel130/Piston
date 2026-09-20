<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tabla puente y no una FK simple en `issues`: un síntoma suele requerir varios
 * intentos antes de resolverse, y saber qué NO lo arregló vale tanto como
 * saber qué sí.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('issue_service_links', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('issue_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('service_record_id')->constrained()->cascadeOnDelete();
            $table->boolean('resolved_it')->default(false);

            $table->pistonSync();

            $table->unique(['issue_id', 'service_record_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('issue_service_links');
    }
};
