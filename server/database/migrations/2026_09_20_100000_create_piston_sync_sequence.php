<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Infraestructura del sync delta.
 *
 * Cada tabla de dominio lleva una columna `rev` que este trigger rellena desde
 * una secuencia GLOBAL (compartida por todas las tablas). El cliente guarda el
 * rev más alto que ha visto y pide `GET /api/sync?since=<rev>`.
 *
 * Se usa una secuencia y no `updated_at` porque los timestamps sufren desfase
 * de reloj, empates dentro del mismo milisegundo y saltos de horario de verano.
 * Los tres hacen que un sync incremental se salte registros en silencio.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE SEQUENCE IF NOT EXISTS piston_rev_seq AS bigint START WITH 1');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION piston_set_rev() RETURNS trigger AS $$
            BEGIN
                NEW.rev := nextval('piston_rev_seq');
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        SQL);
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS piston_set_rev() CASCADE');
        DB::statement('DROP SEQUENCE IF EXISTS piston_rev_seq');
    }
};
