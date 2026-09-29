<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiException;
use App\Http\Responses\ApiCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\IpUtils;
use Symfony\Component\HttpFoundation\Response;

/**
 * Deja pasar solo peticiones hechas desde el propio servidor.
 *
 * Tres decisiones deliberadas:
 *
 * 1. Se lee REMOTE_ADDR directamente y no `$request->ip()`: este último
 *    obedece a TrustProxies, y si algún día se configura un proxy de
 *    confianza, un `X-Forwarded-For: 127.0.0.1` falsificado pasaría por local.
 * 2. Cualquier header de reenvío descalifica la petición. Un proxy inverso en
 *    el mismo host (nginx, Caddy) se conecta desde 127.0.0.1, así que sin esta
 *    regla TODO el tráfico externo que pase por él parecería local.
 * 3. A quien no es local se le responde 404 y no 403: ni siquiera se confirma
 *    que la ruta exista.
 */
class LocalOnly
{
    private const LOOPBACK = ['127.0.0.0/8', '::1'];

    private const FORWARDING_HEADERS = [
        'X-Forwarded-For',
        'X-Forwarded-Host',
        'X-Real-IP',
        'Forwarded',
        'Client-IP',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->isLocal($request)) {
            throw ApiException::of(ApiCode::NotFound);
        }

        return $next($request);
    }

    private function isLocal(Request $request): bool
    {
        $address = $request->server('REMOTE_ADDR');

        if (! is_string($address) || ! IpUtils::checkIp($address, self::LOOPBACK)) {
            return false;
        }

        foreach (self::FORWARDING_HEADERS as $header) {
            if ($request->headers->has($header)) {
                return false;
            }
        }

        return true;
    }
}
