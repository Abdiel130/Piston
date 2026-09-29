<?php

namespace App\Sync;

use App\Http\Responses\ApiCode;
use RuntimeException;

/**
 * Una mutación que el servidor no va a aplicar, y reintentarla tal cual no lo
 * arregla. Corta solo esa mutación: el resto del lote sigue.
 */
final class MutationRejected extends RuntimeException
{
    /** @param  array<string, list<string>>|null  $errors */
    public function __construct(
        public readonly ApiCode $apiCode,
        ?string $message = null,
        public readonly ?array $errors = null,
    ) {
        parent::__construct($message ?? $apiCode->message());
    }
}
