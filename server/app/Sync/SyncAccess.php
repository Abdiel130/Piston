<?php

namespace App\Sync;

use App\Http\Responses\ApiCode;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Quién puede ver y escribir qué.
 *
 * El id lo genera el cliente, así que el servidor no puede fiarse de él: un
 * UUID ajeno en el payload no debe servir para leer ni pisar datos de otra
 * cuenta. Toda consulta del sync pasa por aquí.
 */
final class SyncAccess
{
    /**
     * Serializa el sync de una misma cuenta. El push toma el lock exclusivo y
     * el pull el compartido: así un pull nunca ve un `rev` alto mientras un
     * push de la misma cuenta aún no confirma otro más bajo, que el cursor del
     * cliente se saltaría para siempre.
     */
    public function lock(User $user, bool $exclusive): void
    {
        $function = $exclusive ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
        DB::select("select {$function}(hashtext(?))", ["piston-sync:{$user->getKey()}"]);
    }

    /**
     * @param  Builder<Model>  $query
     * @return Builder<Model>
     */
    public function visible(Builder $query, SyncTable $table, User $user): Builder
    {
        return match ($table->ownership) {
            Ownership::User => $query->where('user_id', $user->getKey()),
            Ownership::UserOrSystem => $query->where(
                fn (Builder $inner) => $inner->where('user_id', $user->getKey())->orWhereNull('user_id'),
            ),
            Ownership::Parent => $query->whereIn(
                $table->parentColumn,
                $this->visible($this->parentOf($table)->query()->select('id'), $this->parentOf($table), $user)->toBase(),
            ),
        };
    }

    /** La cuenta puede modificar esta fila (las del sistema son de solo lectura). */
    public function owns(SyncTable $table, Model $row, User $user): bool
    {
        if ($table->ownership !== Ownership::Parent) {
            return $row->getAttribute('user_id') === $user->getKey();
        }

        $parentTable = $this->parentOf($table);
        $parent = $parentTable->query()->find($row->getAttribute($table->parentColumn));

        return $parent !== null && $this->owns($parentTable, $parent, $user);
    }

    public function canRead(SyncTable $table, Model $row, User $user): bool
    {
        return ($table->ownership === Ownership::UserOrSystem && $row->getAttribute('user_id') === null)
            || $this->owns($table, $row, $user);
    }

    /**
     * Cada llave foránea del payload tiene que apuntar a una fila que exista y
     * que la cuenta pueda ver. Se revisa antes de escribir para devolver un
     * rechazo con campo y no un error de Postgres.
     *
     * @param  array<string, mixed>  $data
     */
    public function assertReferences(SyncTable $table, array $data, User $user): void
    {
        foreach ($table->references() as $column => $referenced) {
            if (isset($data[$column])) {
                $this->assertReachable($referenced, (string) $data[$column], $column, $user);
            }
        }

        if ($table->polymorphicOwner !== null && isset($data['owner_type'], $data['owner_id'])) {
            $referenced = $table->polymorphicOwner[$data['owner_type']];
            $this->assertReachable($referenced, (string) $data['owner_id'], 'owner_id', $user);
        }
    }

    private function assertReachable(string $tableName, string $id, string $column, User $user): void
    {
        $table = SyncRegistry::find($tableName);
        $row = $table?->query()->find($id);

        if ($table === null || $row === null) {
            throw new MutationRejected(
                ApiCode::ParentMissing,
                errors: [$column => ["El servidor todavía no tiene {$tableName}/{$id}."]],
            );
        }

        if (! $this->canRead($table, $row, $user)) {
            throw new MutationRejected(
                ApiCode::Forbidden,
                'Apunta a un registro de otra cuenta.',
                [$column => ['Ese registro no pertenece a tu cuenta.']],
            );
        }
    }

    private function parentOf(SyncTable $table): SyncTable
    {
        return SyncRegistry::find((string) $table->parentTable())
            ?? throw new \LogicException("{$table->name}: tabla padre desconocida.");
    }
}
