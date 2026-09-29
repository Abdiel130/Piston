<?php

namespace App\Http\Responses;

use App\Http\Middleware\AssignRequestId;
use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use JsonSerializable;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * El sobre de TODAS las respuestas JSON de la API.
 *
 *     {
 *       "success": true,
 *       "code": "ok",
 *       "message": "Listo.",
 *       "data": { ... },
 *       "errors": { "campo": ["..."] },   // solo en validation_failed
 *       "meta": { "request_id": "...", "timestamp": "..." }
 *     }
 *
 * - `success` y `code` salen de ApiCode: nadie escribe un status a mano.
 * - `meta.request_id` es el mismo del header `X-Request-Id` y de los logs, para
 *   rastrear un error reportado sin tener que exponer nada del servidor.
 * - Nunca lleva trazas, clases de excepción, SQL ni rutas de archivos.
 *
 * Es inmutable: cada `with*` devuelve una copia, así que una respuesta base se
 * puede reutilizar sin que un cambio se filtre a otra.
 */
final readonly class ApiResponse implements Responsable
{
    /**
     * @param  array<string, list<string>>|null  $errors
     * @param  array<string, mixed>  $meta
     * @param  array<string, string>  $headers
     * @param  list<Cookie>  $cookies
     */
    private function __construct(
        public ApiCode $code,
        public mixed $data = null,
        public ?string $message = null,
        public ?array $errors = null,
        public array $meta = [],
        public array $headers = [],
        public array $cookies = [],
    ) {}

    public static function success(mixed $data = null, ApiCode $code = ApiCode::Ok, ?string $message = null): self
    {
        return new self(code: $code, data: $data, message: $message);
    }

    public static function created(mixed $data = null, ?string $message = null): self
    {
        return self::success($data, ApiCode::Created, $message);
    }

    /** @param  array<string, list<string>>|null  $errors */
    public static function error(ApiCode $code, ?string $message = null, ?array $errors = null): self
    {
        return new self(code: $code, message: $message, errors: $errors);
    }

    /** Datos que acompañan a un error (p. ej. el estado parcial de /health). */
    public function withData(mixed $data): self
    {
        return $this->copy(data: $data);
    }

    public function withMessage(string $message): self
    {
        return $this->copy(message: $message);
    }

    /** @param  array<string, mixed>  $meta */
    public function withMeta(array $meta): self
    {
        return $this->copy(meta: [...$this->meta, ...$meta]);
    }

    /** @param  array<string, string>  $headers */
    public function withHeaders(array $headers): self
    {
        return $this->copy(headers: [...$this->headers, ...$headers]);
    }

    public function withCookie(Cookie $cookie): self
    {
        return $this->copy(cookies: [...$this->cookies, $cookie]);
    }

    public function toResponse($request): JsonResponse
    {
        $body = [
            'success' => $this->code->isSuccess(),
            'code' => $this->code->value,
            'message' => $this->message ?? $this->code->message(),
            'data' => $this->resolveData($request),
        ];

        if ($this->errors !== null) {
            $body['errors'] = $this->errors;
        }

        $body['meta'] = [
            'request_id' => AssignRequestId::of($request),
            'timestamp' => now()->toIso8601ZuluString('millisecond'),
            ...$this->meta,
        ];

        $response = new JsonResponse($body, $this->code->status(), $this->headers, JSON_UNESCAPED_UNICODE);
        // Aquí y no solo en el middleware: un 404 de ruta inexistente se
        // responde antes de que corra el grupo de middleware.
        $response->headers->set(AssignRequestId::HEADER, $body['meta']['request_id']);

        foreach ($this->cookies as $cookie) {
            $response->headers->setCookie($cookie);
        }

        return $response;
    }

    /** Aplana recursos y colecciones al arreglo que realmente viaja. */
    private function resolveData(Request $request): mixed
    {
        return match (true) {
            $this->data instanceof JsonResource => $this->data->resolve($request),
            $this->data instanceof Arrayable => $this->data->toArray(),
            $this->data instanceof JsonSerializable => $this->data->jsonSerialize(),
            default => $this->data,
        };
    }

    /**
     * Copia con los campos indicados cambiados; null = conservar el actual.
     *
     * @param  array<string, mixed>|null  $meta
     * @param  array<string, string>|null  $headers
     * @param  list<Cookie>|null  $cookies
     */
    private function copy(
        mixed $data = null,
        ?string $message = null,
        ?array $meta = null,
        ?array $headers = null,
        ?array $cookies = null,
    ): self {
        return new self(
            code: $this->code,
            data: $data ?? $this->data,
            message: $message ?? $this->message,
            errors: $this->errors,
            meta: $meta ?? $this->meta,
            headers: $headers ?? $this->headers,
            cookies: $cookies ?? $this->cookies,
        );
    }
}
