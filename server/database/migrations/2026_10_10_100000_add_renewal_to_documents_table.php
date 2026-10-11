<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Póliza de seguro: teléfonos a la mano y renovación con historial.
 *
 * Renovar no edita el documento: crea uno nuevo y deja el anterior apuntando
 * a él. Así el historial conserva cada vigencia y solo los documentos sin
 * reemplazo generan avisos de vencimiento.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            // Para reportar un siniestro sin buscar la póliza en papel.
            $table->string('contact_phone', 30)->nullable();
            // Asistencia vial: grúa, paso de corriente, cerrajero.
            $table->string('assistance_phone', 30)->nullable();
            // Número de asegurado o cliente. No todas las aseguradoras lo dan,
            // pero las que sí lo piden al reportar un siniestro.
            $table->string('insured_number', 80)->nullable();
            // Inciso: el renglón de la póliza que cubre este vehículo. Una
            // póliza puede amparar varios autos (flotilla); en una individual
            // casi siempre es 1. Lo piden junto con el número de póliza.
            $table->string('policy_item', 20)->nullable();
            // El documento que lo reemplaza. Nulo = vigente.
            $table->foreignUuid('renewed_by_id')->nullable()
                ->constrained('documents')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('renewed_by_id');
            $table->dropColumn(['contact_phone', 'assistance_phone', 'insured_number', 'policy_item']);
        });
    }
};
