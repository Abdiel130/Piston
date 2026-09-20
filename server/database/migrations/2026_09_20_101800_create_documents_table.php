<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Seguro, verificación, tenencia, tarjeta de circulación, licencia.
 * Cada documento con `expires_at` genera su recordatorio.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->enum('type', [
                'insurance', 'emissions_check', 'ownership_tax',
                'circulation_card', 'driver_license', 'warranty', 'other',
            ]);
            $table->string('title', 160)->nullable();
            $table->string('issuer', 120)->nullable();
            $table->string('reference', 80)->nullable();
            $table->string('coverage', 120)->nullable();
            $table->date('issued_at')->nullable();
            $table->date('expires_at')->nullable();
            $table->decimal('cost', 10, 2)->nullable();
            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['vehicle_id', 'type']);
            $table->index(['user_id', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('documents');
    }
};
