<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Limpieza de sesiones: access tokens vencidos y refresh tokens que ya no
// sirven ni para detectar reuso.
Schedule::command('sanctum:prune-expired --hours=24')->daily();
Schedule::command('piston:auth:prune')->daily();
