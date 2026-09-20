<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 120);
            $table->string('email', 180)->unique();
            $table->timestampTz('email_verified_at')->nullable();
            $table->string('password');

            // Preferencias de presentación. La app es es-MX/MXN/km/L por
            // defecto, pero el dato vive con el usuario, no hardcodeado.
            $table->string('locale', 10)->default('es-MX');
            $table->string('currency', 3)->default('MXN');
            $table->string('distance_unit', 4)->default('km');
            $table->string('volume_unit', 4)->default('L');

            $table->rememberToken();
            $table->timestampsTz();
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestampTz('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignUuid('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('users');
    }
};
