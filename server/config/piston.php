<?php

return [

    /** Versión de la API que se anuncia en /api/health. */
    'version' => '1.2.0',

    /*
    |--------------------------------------------------------------------------
    | Autenticación
    |--------------------------------------------------------------------------
    |
    | Dos tokens. El access token (Sanctum) es corto y vive solo en la memoria
    | del cliente; el refresh token es largo, rota en cada uso y viaja en una
    | cookie HttpOnly que el JavaScript nunca ve.
    |
    | Ninguno de los dos protege los datos locales: esos ya están en el
    | dispositivo y la app los abre sin red. Los tokens protegen el servidor.
    |
    */

    'auth' => [
        'access_ttl_minutes' => (int) env('AUTH_ACCESS_TTL', 15),

        // Deslizante: cada refresh reinicia el plazo. Un dispositivo que se usa
        // al menos una vez cada 60 días no vuelve a pedir contraseña.
        'refresh_ttl_days' => (int) env('AUTH_REFRESH_TTL_DAYS', 60),

        // Dos pestañas pueden refrescar a la vez con el mismo token. Dentro de
        // esta ventana, reusar un token recién rotado se trata como carrera y
        // no como robo.
        'reuse_grace_seconds' => (int) env('AUTH_REUSE_GRACE_SECONDS', 10),

        'cookie' => [
            'name' => 'piston_refresh',
            // Solo viaja a las rutas de auth, nunca al resto de la API.
            'path' => '/api/auth',
            // En desarrollo por LAN (http://192.168.x.x) una cookie Secure no
            // se guarda, así que ahí es configurable. En producción se fuerza:
            // un .env copiado del ejemplo no debe poder desactivarlo.
            'secure' => env('APP_ENV') === 'production' || (bool) env('AUTH_COOKIE_SECURE', false),
        ],

        // Header que el cliente manda en las rutas con cookie. Un header propio
        // obliga al navegador a hacer preflight de CORS, y CORS solo deja pasar
        // los orígenes permitidos: es la defensa CSRF del refresh.
        'client_header' => 'X-Piston-Client',
    ],

];
