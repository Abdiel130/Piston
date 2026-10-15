<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Apagar la notificación del sistema de un documento o recordatorio sin
 * dejar de verlo marcado: el badge sigue, solo no suena. Se sincroniza; si
 * cada dispositivo notifica o no, y de qué tipos, se decide en el dispositivo.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['documents', 'reminders'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->boolean('notify_enabled')->default(true);
            });
        }
    }

    public function down(): void
    {
        foreach (['documents', 'reminders'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropColumn('notify_enabled');
            });
        }
    }
};
