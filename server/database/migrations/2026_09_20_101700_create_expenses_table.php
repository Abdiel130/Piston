<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gastos que no son combustible ni servicio: tenencia, verificación, seguro,
 * lavado, casetas, multas, accesorios.
 *
 * Combustible y servicios NO viven aquí; tienen su propia tabla porque llevan
 * campos y cálculos propios. Los reportes de gasto total los unen por vista.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expenses', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('category_id')->constrained('expense_categories')->restrictOnDelete();
            $table->foreignUuid('recurring_expense_id')->nullable()
                ->constrained('recurring_expenses')->nullOnDelete();

            $table->date('spent_at');
            $table->integer('odometer_km')->nullable();
            $table->decimal('amount', 10, 2);
            $table->string('currency', 3)->default('MXN');
            $table->string('description', 200)->nullable();
            $table->text('notes')->nullable();

            $table->pistonSync();

            $table->index(['vehicle_id', 'spent_at']);
            $table->index(['vehicle_id', 'category_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expenses');
    }
};
