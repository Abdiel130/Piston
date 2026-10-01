<?php

namespace App\Sync;

use Illuminate\Database\Eloquent\Model;

/**
 * Mezcla de tres vías por campo: lo que el cliente vio (`base`), lo que manda
 * (`mine`) y lo que el servidor tiene ahora (`theirs`).
 *
 * - Lo cambió solo el cliente: gana `mine`.
 * - Lo cambió solo el servidor: se queda `theirs`.
 * - Lo cambiaron los dos al mismo valor: no hay nada que decidir.
 * - Lo cambiaron los dos a valores distintos: conflicto, lo decide el usuario.
 *
 * Solo se comparan las columnas escribibles de `SyncRegistry` que vienen en el
 * payload; lo que el cliente no mandó no lo cambió.
 */
final readonly class FieldMerge
{
    /**
     * @param  list<string>  $mine  Campos que se toman del cliente.
     * @param  list<string>  $theirs  Campos que cambió solo el servidor y se conservan.
     * @param  list<string>  $conflicts  Campos que cambiaron los dos, con valores distintos.
     */
    private function __construct(
        public array $mine,
        public array $theirs,
        public array $conflicts,
    ) {}

    /**
     * @param  array<string, mixed>|null  $base  `null` = no se sabe qué vio el cliente:
     *                                           todo lo que difiera es conflicto.
     * @param  array<string, mixed>  $mine  Payload ya validado.
     */
    public static function of(SyncTable $table, ?array $base, array $mine, Model $theirs): self
    {
        $fromMine = [];
        $fromTheirs = [];
        $conflicts = [];

        foreach ($table->fields as $column => $field) {
            if (! array_key_exists($column, $mine)) {
                continue;
            }

            $server = $theirs->getAttribute($column);

            if ($base === null) {
                if (! $field->same($mine[$column], $server)) {
                    $conflicts[] = $column;
                }

                continue;
            }

            $before = $base[$column] ?? null;
            $iChanged = ! $field->same($mine[$column], $before);
            $theyChanged = ! $field->same($server, $before);

            match (true) {
                $iChanged && $theyChanged && ! $field->same($mine[$column], $server) => $conflicts[] = $column,
                $iChanged && ! $theyChanged => $fromMine[] = $column,
                ! $iChanged && $theyChanged => $fromTheirs[] = $column,
                default => null,
            };
        }

        return new self($fromMine, $fromTheirs, $conflicts);
    }

    /**
     * Todo lo que trae el payload, sin comparar: la fila es nueva o nadie más
     * la tocó desde que el cliente la vio.
     *
     * @param  list<string>  $columns
     */
    public static function takeAll(array $columns): self
    {
        return new self($columns, [], []);
    }

    /**
     * Columnas de `current` que difieren de `base`. Sirve en los dos sentidos:
     * qué cambió el servidor antes de un borrado (si nada, borrar no pisa
     * nada) y qué cambió el usuario en una fila que otro borró.
     *
     * @param  array<string, mixed>  $base
     * @param  array<string, mixed>  $current
     * @return list<string>
     */
    public static function changedSince(SyncTable $table, array $base, array $current): array
    {
        $changed = [];

        foreach ($table->fields as $column => $field) {
            if (array_key_exists($column, $current) && ! $field->same($current[$column], $base[$column] ?? null)) {
                $changed[] = $column;
            }
        }

        return $changed;
    }

    public function hasConflicts(): bool
    {
        return $this->conflicts !== [];
    }
}
