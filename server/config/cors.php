<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => [
        'http://localhost:4300',
        'http://127.0.0.1:4300',
        env('FRONTEND_URL', 'http://localhost:4300'),
    ],

    // Solo en desarrollo: el front servido por la IP de la PC en la red local
    // (probar desde el celular). Rangos privados RFC 1918, puerto 4300. En
    // producción la app y la API comparten origen y esto queda vacío.
    'allowed_origins_patterns' => env('APP_ENV') === 'local' ? [
        '#^http://(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}):4300$#',
    ] : [],

    'allowed_headers' => ['*'],

    // El id de la petición, para que la app pueda mostrarlo al reportar un error.
    'exposed_headers' => ['X-Request-Id'],

    'max_age' => 0,

    'supports_credentials' => true,

];
