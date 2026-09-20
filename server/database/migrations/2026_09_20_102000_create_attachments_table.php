<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Una sola tabla para fotos del vehículo, facturas de taller y escaneos de
 * documentos, vía owner_type + owner_id.
 *
 * Lo crítico offline es upload_status + local_blob_key: el archivo se guarda
 * como Blob en IndexedDB y la fila se crea de inmediato como `pending`; el
 * binario sube después por su propia cola. Sin eso, tomar una foto sin señal
 * pierde la foto.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attachments', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();

            // Relación polimórfica: sin FK física, se valida en la aplicación.
            $table->enum('owner_type', [
                'vehicle', 'fuel_entry', 'service_record', 'service_part',
                'expense', 'document', 'issue', 'trip',
            ]);
            $table->uuid('owner_id');

            $table->enum('kind', ['photo', 'invoice', 'document_scan', 'receipt', 'other'])->default('photo');
            $table->string('file_name', 200);
            $table->string('mime_type', 100)->nullable();
            $table->integer('size_bytes')->nullable();
            $table->smallInteger('width')->nullable();
            $table->smallInteger('height')->nullable();
            // SHA-256, para deduplicar y detectar subidas a medias.
            $table->string('checksum', 64)->nullable();
            $table->string('storage_path', 300)->nullable();
            // Solo tiene sentido en el cliente; viaja para que el servidor
            // pueda reconciliar qué blob local corresponde a qué fila.
            $table->string('local_blob_key', 120)->nullable();
            $table->enum('upload_status', ['pending', 'uploading', 'uploaded', 'failed'])->default('pending');
            $table->smallInteger('sort_order')->default(0);

            $table->pistonSync();

            $table->index(['owner_type', 'owner_id']);
            $table->index(['user_id', 'upload_status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
