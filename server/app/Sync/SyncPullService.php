<?php

namespace App\Sync;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Todo lo que cambió después de `since`, tombstones incluidos, para una cuenta.
 *
 * La secuencia `rev` es global a las 20 tablas, así que las filas se mezclan
 * por `rev` y la página se corta en ese orden: el `server_rev` que se devuelve
 * es exactamente el de la última fila entregada y nada queda en medio.
 */
final class SyncPullService
{
    public function __construct(private readonly SyncAccess $access) {}

    /** @return array{changes: array<string, list<array<string, mixed>>>, server_rev: int, has_more: bool} */
    public function pull(User $user, int $since, int $limit): array
    {
        return DB::transaction(function () use ($user, $since, $limit) {
            $this->access->lock($user, exclusive: false);

            /** @var list<array{0: string, 1: Model}> $found */
            $found = [];

            foreach (SyncRegistry::all() as $table) {
                $rows = $this->access
                    ->visible($table->model::query()->sinceRev($since), $table, $user)
                    ->limit($limit + 1)
                    ->get();

                foreach ($rows as $row) {
                    $found[] = [$table->name, $row];
                }
            }

            usort($found, fn (array $a, array $b) => $a[1]->getAttribute('rev') <=> $b[1]->getAttribute('rev'));

            $page = array_slice($found, 0, $limit);
            $changes = [];

            foreach ($page as [$name, $row]) {
                $changes[$name][] = $row->toArray();
            }

            $last = end($page);

            return [
                'changes' => $changes,
                'server_rev' => $last === false ? $since : (int) $last[1]->getAttribute('rev'),
                'has_more' => count($found) > $limit,
            ];
        });
    }
}
