<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Título y notas por adjunto.
 *
 * Una foto suelta no dice qué es. Con título ("¿Cómo reportar un siniestro?")
 * y notas, la imagen que manda la aseguradora se encuentra y se entiende
 * cuando hace falta, sin abrir todas.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attachments', function (Blueprint $table) {
            $table->string('title', 120)->nullable();
            $table->text('notes')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('attachments', function (Blueprint $table) {
            $table->dropColumn(['title', 'notes']);
        });
    }
};
