<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Reglas de gasto periódico: seguro anual, tenencia anual, verificación
 * semestral. Generan filas en `expenses` cuando toca.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recurring_expenses', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('category_id')->constrained('expense_categories')->restrictOnDelete();

            $table->string('name', 120);
            $table->decimal('amount_estimate', 10, 2)->nullable();
            $table->enum('periodicity', ['monthly', 'quarterly', 'semiannual', 'annual', 'custom_days']);
            // Solo se usa si periodicity = custom_days.
            $table->smallInteger('interval_days')->nullable();
            $table->date('next_due_date');
            $table->boolean('auto_create')->default(false);
            $table->boolean('is_active')->default(true);

            $table->pistonSync();

            $table->index(['user_id', 'next_due_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recurring_expenses');
    }
};
