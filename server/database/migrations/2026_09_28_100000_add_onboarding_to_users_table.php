<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Estado del wizard de bienvenida.
 *
 * Vive en el servidor además del dispositivo para que quien empiece el wizard
 * en el teléfono y lo abandone pueda retomarlo en otro, en el mismo paso y con
 * lo que ya había escrito.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('onboarding_step', 20)->default('account');
            // Borrador del formulario. Nada del wizard toca tablas de dominio
            // hasta el último paso, así que lo a medias vive solo aquí.
            $table->jsonb('onboarding_draft')->nullable();
            // Reloj del CLIENTE que escribió el borrador: base del last-write-wins
            // entre dos dispositivos que editan el wizard a la vez.
            $table->timestampTz('onboarding_updated_at')->nullable();
            $table->timestampTz('onboarding_completed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'onboarding_step',
                'onboarding_draft',
                'onboarding_updated_at',
                'onboarding_completed_at',
            ]);
        });
    }
};
