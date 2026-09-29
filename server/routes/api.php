<?php

use App\Http\Controllers\AttachmentFileController;
use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\LogoutController;
use App\Http\Controllers\Auth\RefreshController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\OnboardingController;
use App\Http\Controllers\SyncController;
use App\Http\Middleware\EnsurePistonClient;
use App\Http\Middleware\LocalOnly;
use Illuminate\Support\Facades\Route;

/*
| Auth. Estas rutas son las únicas que reciben la cookie del refresh (su Path
| es /api/auth), así que todas exigen el header del cliente como defensa CSRF.
| No hay registro: las cuentas se crean con `php artisan piston:user:create`.
*/
Route::prefix('auth')->middleware(EnsurePistonClient::class)->group(function () {
    Route::post('login', LoginController::class)->middleware('throttle:login');
    Route::post('refresh', RefreshController::class)->middleware('throttle:refresh');
    Route::post('logout', LogoutController::class)->middleware('auth:sanctum');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('me', [MeController::class, 'show']);
    Route::patch('me', [MeController::class, 'update']);
    Route::put('me/password', [MeController::class, 'password'])->middleware('throttle:login');
    Route::put('me/onboarding', [OnboardingController::class, 'update']);
    Route::post('me/onboarding/complete', [OnboardingController::class, 'complete']);
});

/*
| Sync. El cliente sincroniza en cuanto hay un cambio, así que el límite es
| holgado; solo frena a un cliente en bucle.
*/
Route::middleware(['auth:sanctum', 'throttle:sync'])->group(function () {
    Route::get('sync', [SyncController::class, 'pull']);
    Route::post('sync', [SyncController::class, 'push']);
    Route::get('sync/{table}/{id}', [SyncController::class, 'show']);
    Route::post('attachments/{id}/file', AttachmentFileController::class);
});

/*
| Salud del servicio. SOLO desde el propio servidor (loopback, sin proxy de por
| medio); para cualquier otro no existe. Desde el host: `./piston health`, que
| consulta desde dentro del contenedor.
*/
Route::get('health', HealthController::class)->middleware(LocalOnly::class);
