<?php

namespace App\Exceptions;

use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use RuntimeException;
use Throwable;

/**
 * Error que ya sabe cómo contestarse.
 *
 * Para cortar un flujo desde cualquier capa HTTP (controlador, form request,
 * middleware) con un resultado del catálogo, sin armar la respuesta a mano:
 *
 *     throw ApiException::of(ApiCode::Conflict, 'El vehículo ya existe.');
 */
class ApiException extends RuntimeException
{
    /** @param  array<string, list<string>>|null  $errors */
    final public function __construct(
        public readonly ApiCode $apiCode,
        ?string $message = null,
        public readonly ?array $errors = null,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message ?? $apiCode->message(), 0, $previous);
    }

    /** @param  array<string, list<string>>|null  $errors */
    public static function of(ApiCode $code, ?string $message = null, ?array $errors = null): static
    {
        return new static($code, $message, $errors);
    }

    public function toApiResponse(): ApiResponse
    {
        return ApiResponse::error($this->apiCode, $this->getMessage(), $this->errors);
    }
}
