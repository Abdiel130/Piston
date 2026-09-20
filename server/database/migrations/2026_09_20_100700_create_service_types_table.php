<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_types', function (Blueprint $table) {
            $table->pistonKey();
            // NULL = catálogo del sistema. Evita duplicar el catálogo entero
            // por cada cuenta y deja al usuario crear los suyos.
            $table->foreignUuid('user_id')->nullable()->constrained()->cascadeOnDelete();

            $table->string('name', 120);
            $table->enum('category', [
                'oil_filters', 'brakes', 'suspension', 'tires',
                'engine', 'transmission', 'electrical', 'body', 'general',
            ])->default('general');
            // NULL = aplica a cualquier tipo de vehículo.
            $table->enum('applies_to', ['car', 'motorcycle', 'pickup', 'truck', 'van'])->nullable();
            $table->integer('default_interval_km')->nullable();
            $table->smallInteger('default_interval_months')->nullable();
            $table->string('icon', 40)->nullable();
            $table->boolean('is_system')->default(false);

            $table->pistonSync();

            $table->index(['user_id', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_types');
    }
};
