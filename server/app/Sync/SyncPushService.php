<?php

namespace App\Sync;

use App\Http\Responses\ApiCode;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Throwable;

/**
 * Aplica un lote de mutaciones del cliente.
 *
 * Tres garantías que el cliente da por hechas:
 *
 * 1. **Aislamiento.** Cada mutación corre en su propio SAVEPOINT: una fila
 *    inválida se rechaza sola y el resto del lote se aplica.
 * 2. **Idempotencia.** El insert es un upsert por el UUID del cliente y borrar
 *    lo que no existe es un no-op. Reenviar el mismo lote tras un timeout (sin
 *    saber si llegó) es seguro, así que no hace falta Idempotency-Key.
 * 3. **Nada se pierde en silencio.** La mutación trae `base_rev`, el `rev` que
 *    tenía la fila cuando el cliente empezó a editarla, y `base`, la fila tal
 *    como la vio. Si nadie más la tocó, se aplica. Si otro dispositivo la
 *    cambió, se mezcla por campo (`FieldMerge`): lo que no choca se combina
 *    solo y lo que sí choca vuelve como `conflict` para que el usuario decida.
 *    El reloj del dispositivo no decide nada.
 *
 * Una mutación sin `base_rev` (outbox de un cliente anterior) conserva el
 * last-write-wins por `client_updated_at` de siempre.
 */
final class SyncPushService
{
    public function __construct(private readonly SyncAccess $access) {}

    /**
     * @param  list<array{table: string, id: string, op: string, payload?: array<string, mixed>|null, base_rev?: int|null, base?: array<string, mixed>|null, resolve?: string|null}>  $mutations
     * @return array{applied: list<array<string, mixed>>, rejected: list<array<string, mixed>>, server_rev: int}
     */
    public function push(User $user, array $mutations): array
    {
        return DB::transaction(function () use ($user, $mutations) {
            $this->access->lock($user, exclusive: true);

            $applied = [];
            $rejected = [];

            foreach ($mutations as $mutation) {
                try {
                    // Transacción anidada = SAVEPOINT en Postgres.
                    $applied[] = DB::transaction(fn () => $this->apply($user, $mutation));
                } catch (MutationRejected $rejection) {
                    $rejected[] = $this->reject($mutation, $rejection);
                } catch (QueryException $error) {
                    $rejected[] = $this->reject($mutation, $this->fromDatabase($error) ?? throw $error);
                }
            }

            return [
                'applied' => $applied,
                'rejected' => $rejected,
                'server_rev' => (int) max([0, ...array_column($applied, 'rev')]),
            ];
        });
    }

    /**
     * @param  array{table: string, id: string, op: string, payload?: array<string, mixed>|null, base_rev?: int|null, base?: array<string, mixed>|null, resolve?: string|null}  $mutation
     * @return array<string, mixed>
     */
    private function apply(User $user, array $mutation): array
    {
        $table = SyncRegistry::find($mutation['table'])
            ?? throw new MutationRejected(ApiCode::UnknownTable);

        $existing = $table->query()->find($mutation['id']);

        if ($existing !== null && ! $this->access->owns($table, $existing, $user)) {
            throw new MutationRejected(ApiCode::Forbidden, 'Ese registro pertenece a otra cuenta o es del sistema.');
        }

        $payload = $mutation['payload'] ?? [];
        $incomingAt = $this->clientTime($payload);
        $baseRev = $mutation['base_rev'] ?? null;

        if ($baseRev === null) {
            return $this->applyLastWriteWins($user, $table, $mutation, $existing, $incomingAt);
        }

        $base = $mutation['base'] ?? null;

        if ($mutation['op'] === 'delete') {
            return $this->deleteVersioned($table, $mutation['id'], $existing, (int) $baseRev, $base, $incomingAt);
        }

        $data = $this->validate($table, $payload);
        $this->access->assertReferences($table, $data, $user, $existing);

        $merge = $this->merge(
            $table, $mutation, $existing, (int) $baseRev, $base, $data,
            restore: ($mutation['resolve'] ?? null) === 'restore',
        );

        if ($existing !== null && $merge->mine === []) {
            // Lo único distinto venía del servidor: no se escribe, así el
            // `rev` no sube por nada.
            return $this->result($table, $existing, merged: $merge->theirs);
        }

        $row = $existing ?? tap(new $table->model, fn (Model $new) => $new->setAttribute('id', $mutation['id']));
        $row->forceFill(array_intersect_key($data, array_flip($merge->mine)));

        if ($row->trashed()) {
            $row->setAttribute('deleted_at', null);
        }
        if ($table->hasUserColumn()) {
            $row->setAttribute('user_id', $user->getKey());
        }
        $row->setAttribute('client_updated_at', $incomingAt ?? now());
        $row->save();

        return $this->result($table, $row, merged: $merge->theirs);
    }

    /**
     * Qué columnas del payload escribir (`mine`) y cuáles del servidor se
     * conservan (`theirs`). Lanza el conflicto si las dos versiones chocan.
     *
     * @param  array<string, mixed>  $mutation
     * @param  array<string, mixed>|null  $base
     * @param  array<string, mixed>  $data
     */
    private function merge(
        SyncTable $table,
        array $mutation,
        ?Model $existing,
        int $baseRev,
        ?array $base,
        array $data,
        bool $restore,
    ): FieldMerge {
        $all = FieldMerge::takeAll(array_keys($data));

        if ($existing === null) {
            return $all;
        }

        $rev = (int) $existing->getAttribute('rev');

        // Otro dispositivo lo borró mientras este lo editaba. Solo se resucita
        // si el usuario lo pidió explícitamente desde el conflicto, y sobre la
        // versión del tombstone que vio.
        if ($existing->trashed()) {
            if (! $restore || $baseRev !== $rev) {
                $mine = $base === null ? array_keys($data) : FieldMerge::changedSince($table, $base, $data);
                throw MutationRejected::conflict('edit_delete', $mine, $table, $mutation['id']);
            }

            return $all;
        }

        if ($baseRev === $rev) {
            return $all;
        }

        // Un insert con base 0 sobre una fila que ya existe solo puede ser este
        // mismo dispositivo reenviando tras un timeout: el UUID es suyo.
        if ($mutation['op'] === 'insert' && $baseRev === 0) {
            return $all;
        }

        $merge = FieldMerge::of($table, $base, $data, $existing);

        if ($merge->hasConflicts()) {
            throw MutationRejected::conflict('edit_edit', $merge->conflicts, $table, $mutation['id']);
        }

        if ($merge->theirs !== []) {
            Log::channel('sync')->info('sync.merged', [
                'table' => $table->name,
                'id' => $mutation['id'],
                'base_rev' => $baseRev,
                'server_rev' => $rev,
                'mine' => $merge->mine,
                'theirs' => $merge->theirs,
            ]);
        }

        return $merge;
    }

    /**
     * Borrado con versión. Si otro dispositivo editó la fila después de lo que
     * este vio, borrarla tiraría esa edición: es conflicto.
     *
     * @param  array<string, mixed>|null  $base
     * @return array<string, mixed>
     */
    private function deleteVersioned(
        SyncTable $table,
        string $id,
        ?Model $existing,
        int $baseRev,
        ?array $base,
        ?CarbonImmutable $incomingAt,
    ): array {
        if ($existing === null || $existing->trashed()) {
            // Nunca llegó, ya se purgó o ya estaba borrado: lo que el cliente
            // quiere (que no exista) ya se cumple.
            return $existing === null
                ? ['table' => $table->name, 'id' => $id, 'rev' => 0, 'stale' => false, 'row' => null, 'merged' => []]
                : $this->result($table, $existing);
        }

        if ($baseRev !== (int) $existing->getAttribute('rev')) {
            $changed = $base === null
                ? array_keys($table->fields)
                : FieldMerge::changedSince($table, $base, $existing->attributesToArray());

            if ($changed !== []) {
                throw MutationRejected::conflict('edit_delete', $changed, $table, $id);
            }
        }

        $existing->forceFill([
            'deleted_at' => now(),
            'client_updated_at' => $incomingAt ?? now(),
        ])->save();

        return $this->result($table, $existing);
    }

    /**
     * El comportamiento anterior a `base_rev`, para entradas viejas del outbox.
     *
     * @param  array<string, mixed>  $mutation
     * @return array<string, mixed>
     */
    private function applyLastWriteWins(
        User $user,
        SyncTable $table,
        array $mutation,
        ?Model $existing,
        ?CarbonImmutable $incomingAt,
    ): array {
        if ($mutation['op'] === 'delete') {
            return $this->delete($table, $mutation['id'], $existing, $incomingAt);
        }

        $data = $this->validate($table, $mutation['payload'] ?? []);
        $this->access->assertReferences($table, $data, $user, $existing);

        // Un tombstone gana siempre: si otro dispositivo ya lo borró, una
        // edición atrasada no lo resucita.
        if ($existing?->trashed() || $this->isStale($existing, $incomingAt)) {
            return $this->result($table, $existing, stale: true);
        }

        $row = $existing ?? tap(new $table->model, fn (Model $new) => $new->setAttribute('id', $mutation['id']));
        $row->forceFill($data);

        if ($table->hasUserColumn()) {
            $row->setAttribute('user_id', $user->getKey());
        }
        $row->setAttribute('client_updated_at', $incomingAt ?? now());
        $row->save();

        return $this->result($table, $row);
    }

    /** @return array<string, mixed> */
    private function delete(SyncTable $table, string $id, ?Model $existing, ?CarbonImmutable $incomingAt): array
    {
        if ($existing === null) {
            // Nunca llegó o ya se purgó: el resultado que el cliente quiere
            // (que no exista) ya se cumple.
            return ['table' => $table->name, 'id' => $id, 'rev' => 0, 'stale' => false, 'row' => null, 'merged' => []];
        }

        if (! $existing->trashed() && ! $this->isStale($existing, $incomingAt)) {
            $existing->forceFill([
                'deleted_at' => now(),
                'client_updated_at' => $incomingAt ?? now(),
            ])->save();

            return $this->result($table, $existing);
        }

        return $this->result($table, $existing, stale: ! $existing->trashed());
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function validate(SyncTable $table, array $payload): array
    {
        $validator = Validator::make($table->prepare($payload), $table->rules());

        if ($validator->fails()) {
            throw new MutationRejected(
                ApiCode::ValidationFailed,
                $validator->errors()->first(),
                $validator->errors()->toArray(),
            );
        }

        return $validator->validated();
    }

    /** @param  array<string, mixed>  $payload */
    private function clientTime(array $payload): ?CarbonImmutable
    {
        $value = $payload['client_updated_at'] ?? null;

        if ($value === null) {
            return null;
        }

        try {
            return CarbonImmutable::parse((string) $value);
        } catch (Throwable) {
            throw new MutationRejected(
                ApiCode::ValidationFailed,
                'La fecha de modificación no es válida.',
                ['client_updated_at' => ['La fecha de modificación no es válida.']],
            );
        }
    }

    private function isStale(?Model $existing, ?CarbonImmutable $incomingAt): bool
    {
        $storedAt = $existing?->getAttribute('client_updated_at');

        return $incomingAt !== null && $storedAt !== null && $storedAt->greaterThan($incomingAt);
    }

    /**
     * La fila tal como quedó, releída: `rev` lo pone el trigger dentro de
     * Postgres y Eloquent no lo relee. El cliente guarda `row` tal cual, así
     * que si hubo mezcla se queda con la versión combinada sin esperar al pull.
     *
     * @param  list<string>  $merged  Campos que se conservaron del servidor al mezclar.
     * @return array<string, mixed>
     */
    private function result(SyncTable $table, ?Model $row, bool $stale = false, array $merged = []): array
    {
        $fresh = $row === null ? null : $table->query()->find($row->getKey());

        return [
            'table' => $table->name,
            'id' => (string) $row?->getKey(),
            'rev' => (int) $fresh?->getAttribute('rev'),
            'stale' => $stale,
            'row' => $fresh?->toArray(),
            'merged' => $merged,
        ];
    }

    /**
     * Lo que se escapó a la validación y reventó en Postgres, traducido a un
     * rechazo por fila. Lo que no sea un problema del dato (conexión, disco,
     * deadlock) se relanza: eso sí es un 500 y el cliente lo reintentará.
     */
    private function fromDatabase(QueryException $error): ?MutationRejected
    {
        $state = (string) ($error->errorInfo[0] ?? $error->getCode());

        return match (true) {
            $state === '23505' => new MutationRejected(
                ApiCode::Conflict,
                'Ya existe otro registro con esos mismos datos (duplicado).',
            ),
            $state === '23503' => new MutationRejected(ApiCode::ParentMissing),
            $state === '23502', $state === '23514', str_starts_with($state, '22') => new MutationRejected(
                ApiCode::ValidationFailed,
                'Un valor no es válido para el servidor.',
            ),
            default => null,
        };
    }

    /**
     * @param  array{table: string, id: string, op: string, base_rev?: int|null}  $mutation
     * @return array<string, mixed>
     */
    private function reject(array $mutation, MutationRejected $rejection): array
    {
        Log::channel('sync')->warning($rejection->conflict !== null ? 'sync.conflict' : 'sync.rejected', [
            'table' => $mutation['table'],
            'id' => $mutation['id'],
            'op' => $mutation['op'],
            'code' => $rejection->apiCode->value,
            'message' => $rejection->getMessage(),
            'errors' => $rejection->errors,
            'kind' => $rejection->conflict['kind'] ?? null,
            'fields' => $rejection->conflict['fields'] ?? null,
            'base_rev' => $mutation['base_rev'] ?? null,
        ]);

        return [
            'table' => $mutation['table'],
            'id' => $mutation['id'],
            'code' => $rejection->apiCode->value,
            'message' => $rejection->getMessage(),
            'errors' => $rejection->errors,
            ...($rejection->conflict !== null ? ['conflict' => $rejection->conflict] : []),
        ];
    }
}
