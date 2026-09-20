<?php

namespace App\Providers;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->registerSchemaMacros();
    }

    /**
     * Columnas que toda tabla de dominio de Piston comparte.
     *
     * Ver docs/schema.dbml para el porqué de cada una. En resumen: el id es
     * UUIDv7 generado en el cliente (los registros creados offline nacen con su
     * id definitivo), client_updated_at es la base del last-write-wins,
     * deleted_at es un tombstone sincronizable, y rev es un contador global que
     * hace barato el sync delta.
     */
    private function registerSchemaMacros(): void
    {
        Blueprint::macro('pistonKey', function (): void {
            /** @var Blueprint $this */
            $this->uuid('id')->primary();
        });

        Blueprint::macro('pistonSync', function (): void {
            /** @var Blueprint $this */
            $this->timestampsTz();
            $this->timestampTz('client_updated_at')->nullable();
            $this->softDeletesTz();

            // Lo escribe el trigger piston_set_rev() en cada INSERT/UPDATE.
            $this->bigInteger('rev')->default(0);
            $this->index('rev');
        });
    }
}
