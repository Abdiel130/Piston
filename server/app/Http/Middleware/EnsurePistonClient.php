<?php

namespace App\Http\Middleware;

use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Defensa CSRF de las rutas que viajan con cookie.
 *
 * Un formulario de otro sitio no puede poner headers propios, y un fetch que
 * lo intente dispara un preflight que CORS rechaza fuera de los orígenes
 * permitidos. Así que si el header llegó, lo mandó nuestra app.
 */
class EnsurePistonClient
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->hasHeader(config('piston.auth.client_header'))) {
            return ApiResponse::error(ApiCode::ClientHeaderMissing)->toResponse($request);
        }

        return $next($request);
    }
}
