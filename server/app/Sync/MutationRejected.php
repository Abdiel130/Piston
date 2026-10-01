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
    /**
     * @param  array<string, list<string>>|null  $errors
     * @param  array<string, mixed>|null  $conflict  Detalle para que el usuario decida (ver `conflict()`).
     */
    public function __construct(
        public readonly ApiCode $apiCode,
        ?string $message = null,
        public readonly ?array $errors = null,
        public readonly ?array $conflict = null,
    ) {
        parent::__construct($message ?? $apiCode->message());
    }

    /**
     * Dos versiones que el servidor no puede mezclar solo.
     *
     * @param  'edit_edit'|'edit_delete'  $kind
     * @param  list<string>  $fields  En `edit_edit`, los que chocan; en `edit_delete`, los que cambió quien editó.
     */
    public static function conflict(string $kind, array $fields, SyncTable $table, string $id): self
    {
        $row = $table->query()->find($id);
        $message = $kind === 'edit_edit'
            ? 'Se editó en otro dispositivo al mismo tiempo.'
            : 'Se borró en otro dispositivo mientras se editaba en este.';

        return new self(ApiCode::Conflict, $message, conflict: [
            'kind' => $kind,
            'fields' => $fields,
            'server_row' => $row?->toArray(),
            'server_rev' => (int) $row?->getAttribute('rev'),
        ]);
    }
}
