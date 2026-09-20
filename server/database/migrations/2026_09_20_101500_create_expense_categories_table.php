<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->pistonKey();
            // NULL = categoría del sistema.
            $table->foreignUuid('user_id')->nullable()->constrained()->cascadeOnDelete();

            $table->string('name', 80);
            $table->string('icon', 40)->nullable();
            $table->boolean('is_system')->default(false);

            $table->pistonSync();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expense_categories');
    }
};
