<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Da a cada petición un id que viaja en el header `X-Request-Id`, en el
 * `meta.request_id` del sobre y en el contexto de TODOS los logs.
 *
 * Así, cuando alguien reporta "me salió un error", ese id basta para encontrar
 * la traza en el servidor sin que la respuesta haya expuesto nada.
 */
class AssignRequestId
{
    public const HEADER = 'X-Request-Id';

    private const ATTRIBUTE = 'request_id';

    public function handle(Request $request, Closure $next): Response
    {
        $id = self::of($request);

        Log::withContext(['request_id' => $id]);

        $response = $next($request);
        $response->headers->set(self::HEADER, $id);

        return $response;
    }

    /**
     * El id de la petición, creándolo si aún no existe.
     *
     * Se acepta el que mande el cliente solo si es un UUID: así se puede
     * correlacionar desde la app sin permitir que alguien inyecte texto
     * arbitrario en los logs.
     */
    public static function of(Request $request): string
    {
        $id = $request->attributes->get(self::ATTRIBUTE);

        if (! is_string($id)) {
            $incoming = $request->headers->get(self::HEADER);
            $id = is_string($incoming) && Str::isUuid($incoming) ? $incoming : (string) Str::uuid7();
            $request->attributes->set(self::ATTRIBUTE, $id);
        }

        return $id;
    }
}
