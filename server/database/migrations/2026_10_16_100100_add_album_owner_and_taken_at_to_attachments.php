<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adjuntos de un álbum y la fecha en que se tomó la foto.
 *
 * `taken_at` sale del EXIF (o de la fecha del archivo) y ordena la galería:
 * una foto vieja subida hoy queda en su lugar en la evolución del vehículo.
 *
 * `owner_type` es un CHECK en Postgres (así crea Laravel los enum); se
 * reemplaza para aceptar `album`.
 */
return new class extends Migration
{
    private const OWNERS = [
        'vehicle', 'fuel_entry', 'service_record', 'service_part',
        'expense', 'document', 'issue', 'trip',
    ];

    public function up(): void
    {
        $this->ownerCheck([...self::OWNERS, 'album']);

        Schema::table('attachments', function (Blueprint $table) {
            $table->timestampTz('taken_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('attachments', function (Blueprint $table) {
            $table->dropColumn('taken_at');
        });

        $this->ownerCheck(self::OWNERS);
    }

    /** @param  list<string>  $owners */
    private function ownerCheck(array $owners): void
    {
        $list = implode(', ', array_map(fn (string $owner) => "'{$owner}'", $owners));

        DB::statement('ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_owner_type_check');
        DB::statement("ALTER TABLE attachments ADD CONSTRAINT attachments_owner_type_check CHECK (owner_type IN ({$list}))");
    }
};
