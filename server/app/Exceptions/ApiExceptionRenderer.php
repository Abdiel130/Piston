<?php

namespace App\Exceptions;

use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Convierte cualquier excepción en el sobre estándar.
 *
 * Su única regla de seguridad: el texto de una excepción NO controlada nunca
 * llega al cliente. Puede traer SQL, rutas o nombres internos; se queda en el
 * log (con el mismo request_id que ve el cliente) y afuera sale un mensaje
 * genérico.
 */
class ApiExceptionRenderer
{
    public function render(Throwable $error, Request $request): ApiResponse
    {
        return match (true) {
            $error instanceof ApiException => $error->toApiResponse(),

            $error instanceof ValidationException => ApiResponse::error(
                ApiCode::ValidationFailed,
                $error->validator->errors()->first() ?: null,
                $error->errors(),
            ),

            $error instanceof AuthenticationException => ApiResponse::error(ApiCode::Unauthenticated),

            $error instanceof AuthorizationException => ApiResponse::error(ApiCode::Forbidden),

            $error instanceof ModelNotFoundException => ApiResponse::error(ApiCode::NotFound),

            $error instanceof ThrottleRequestsException => $this->throttled($error),

            // Las HttpException de Symfony llevan mensajes pensados para el
            // cliente solo cuando alguien los escribió a propósito (abort(403,
            // '...')); los del framework (rutas, métodos) exponen internals.
            $error instanceof HttpExceptionInterface => ApiResponse::error(
                ApiCode::fromStatus($error->getStatusCode()),
            )->withHeaders($error->getHeaders()),

            default => ApiResponse::error(ApiCode::ServerError),
        };
    }

    private function throttled(ThrottleRequestsException $error): ApiResponse
    {
        $headers = $error->getHeaders();
        $retryAfter = isset($headers['Retry-After']) ? (int) $headers['Retry-After'] : null;

        return ApiResponse::error(ApiCode::TooManyRequests)
            ->withHeaders($headers)
            ->withMeta(['retry_after' => $retryAfter]);
    }
}
