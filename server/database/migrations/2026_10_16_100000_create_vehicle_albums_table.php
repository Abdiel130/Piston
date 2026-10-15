<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Álbumes de fotos del vehículo: agrupan fotos para ver su evolución o
 * desgaste (un proyecto, una restauración). Las fotos son adjuntos con
 * `owner_type = 'album'`; las sueltas siguen colgando del vehículo.
 *
 * `cover_attachment_id` no lleva FK: el adjunto cuelga del álbum, así que
 * una FK cerraría un ciclo. Si la portada se borra, el cliente usa la foto
 * más reciente.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicle_albums', function (Blueprint $table) {
            $table->pistonKey();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('vehicle_id')->constrained()->cascadeOnDelete();

            $table->string('name', 80);
            $table->text('description')->nullable();
            $table->uuid('cover_attachment_id')->nullable();
            $table->smallInteger('sort_order')->default(0);

            $table->pistonSync();

            $table->index(['vehicle_id', 'sort_order']);
        });

        DB::unprepared(
            'CREATE TRIGGER vehicle_albums_set_rev
             BEFORE INSERT OR UPDATE ON vehicle_albums
             FOR EACH ROW EXECUTE FUNCTION piston_set_rev();'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_albums');
    }
};
