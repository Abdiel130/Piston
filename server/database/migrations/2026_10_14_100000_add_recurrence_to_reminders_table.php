<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recordatorios que se repiten, con bitácora.
 *
 * Marcar uno como hecho no mueve su vencimiento: lo cierra (`done`) con la
 * fecha y el km en que se hizo, y crea el siguiente con la misma
 * configuración. Los cerrados son la bitácora.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reminders', function (Blueprint $table) {
            // Cada N días, semanas, meses o años. Nulo = no se repite por fecha.
            $table->integer('repeat_every')->nullable();
            $table->enum('repeat_unit', ['day', 'week', 'month', 'year'])->nullable();
            // Cada N km. Puede ir junto con la fecha: lo que llegue primero.
            $table->integer('repeat_km')->nullable();
            // `done`: el periodo cuenta desde que se hizo (aceite cada 2 meses).
            // `due`: desde el vencimiento anterior (refrendo cada 15 de marzo).
            $table->enum('repeat_anchor', ['done', 'due'])->default('done');
            $table->text('notes')->nullable();
            // Cuándo y con cuántos km se hizo. Solo en la bitácora.
            $table->date('done_at')->nullable();
            $table->integer('done_odometer_km')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('reminders', function (Blueprint $table) {
            $table->dropColumn([
                'repeat_every', 'repeat_unit', 'repeat_km', 'repeat_anchor',
                'notes', 'done_at', 'done_odometer_km',
            ]);
        });
    }
};
