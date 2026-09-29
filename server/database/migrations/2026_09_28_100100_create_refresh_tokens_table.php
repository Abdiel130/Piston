<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Refresh tokens rotativos.
 *
 * Cada login abre una FAMILIA; cada refresh revoca el token usado y emite otro
 * de la misma familia. Si alguien presenta un token ya rotado, es que se copió:
 * se revoca la familia entera y ambos —el legítimo y el ladrón— tienen que
 * volver a iniciar sesión.
 *
 * Solo se guarda el hash SHA-256. El valor en claro existe únicamente en la
 * cookie HttpOnly del dispositivo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('refresh_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('family_id');
            $table->string('token_hash', 64)->unique();

            $table->string('device_name', 120)->nullable();
            $table->text('user_agent')->nullable();
            $table->string('ip_address', 45)->nullable();

            $table->timestampTz('expires_at');
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            // No-nulo = se revocó por rotación, no por logout. Distingue la
            // carrera inocente entre pestañas de un token robado.
            $table->timestampTz('replaced_at')->nullable();
            $table->timestampsTz();

            $table->index('family_id');
            $table->index(['user_id', 'revoked_at']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('refresh_tokens');
    }
};
