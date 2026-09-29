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
 * 3. **Last-write-wins.** Una escritura con `client_updated_at` más viejo que
 *    el de la fila guardada no la pisa; se responde `stale` y el siguiente
 *    pull le entrega al cliente la versión ganadora.
 */
final class SyncPushService
{
    public function __construct(private readonly SyncAccess $access) {}

    /**
     * @param  list<array{table: string, id: string, op: string, payload?: array<string, mixed>|null}>  $mutations
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
     * @param  array{table: string, id: string, op: string, payload?: array<string, mixed>|null}  $mutation
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

        if ($mutation['op'] === 'delete') {
            return $this->delete($table, $mutation['id'], $existing, $incomingAt);
        }

        $data = $this->validate($table, $payload);
        $this->access->assertReferences($table, $data, $user);

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
            return ['table' => $table->name, 'id' => $id, 'rev' => 0, 'stale' => false];
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
        $validator = Validator::make($payload, $table->rules());

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

    /** @return array<string, mixed> */
    private function result(SyncTable $table, ?Model $row, bool $stale = false): array
    {
        // `rev` lo pone el trigger dentro de Postgres; Eloquent no lo relee.
        $rev = $row === null ? 0 : (int) $table->query()->whereKey($row->getKey())->value('rev');

        return ['table' => $table->name, 'id' => (string) $row?->getKey(), 'rev' => $rev, 'stale' => $stale];
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
     * @param  array{table: string, id: string, op: string}  $mutation
     * @return array<string, mixed>
     */
    private function reject(array $mutation, MutationRejected $rejection): array
    {
        Log::channel('sync')->warning('sync.rejected', [
            'table' => $mutation['table'],
            'id' => $mutation['id'],
            'op' => $mutation['op'],
            'code' => $rejection->apiCode->value,
            'message' => $rejection->getMessage(),
            'errors' => $rejection->errors,
        ]);

        return [
            'table' => $mutation['table'],
            'id' => $mutation['id'],
            'code' => $rejection->apiCode->value,
            'message' => $rejection->getMessage(),
            'errors' => $rejection->errors,
        ];
    }
}
