<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
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
        $this->registerRateLimiters();
    }

    /**
     * Límites de las rutas de auth.
     *
     * El login se limita por correo + IP: por correo solo, un atacante podría
     * bloquear la cuenta de otro a propósito; por IP sola, rotar correos desde
     * la misma máquina no costaría nada.
     */
    private function registerRateLimiters(): void
    {
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)->by(
            mb_strtolower((string) $request->input('email')).'|'.$request->ip(),
        ));

        // Un cliente sano refresca una vez cada ~15 minutos por pestaña.
        RateLimiter::for('refresh', fn (Request $request) => Limit::perMinute(30)->by($request->ip()));
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
