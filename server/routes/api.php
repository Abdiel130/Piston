<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::get('/health', function () {
    $dbStatus = 'disconnected';
    $dbError = null;

    try {
        \Illuminate\Support\Facades\DB::connection()->getPdo();
        $dbStatus = 'connected';
    } catch (\Throwable $e) {
        $dbError = $e->getMessage();
    }

    return response()->json([
        'status' => 'ok',
        'project' => 'Piston API',
        'version' => '1.0.0',
        'laravel_version' => app()->version(),
        'php_version' => PHP_VERSION,
        'database' => [
            'status' => $dbStatus,
            'driver' => config('database.default'),
            'error' => $dbError,
        ],
        'timestamp' => now()->toIso8601String(),
    ]);
});

