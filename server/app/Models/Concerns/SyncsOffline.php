<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * Contrato de sincronización compartido por toda entidad de dominio.
 *
 * Tres cosas que este trait deja claras y que es fácil romper sin él:
 *
 * 1. La clave primaria es un UUIDv7 que genera el CLIENTE, no el servidor. Por
 *    eso $incrementing = false y no se usa el trait HasUuids de Laravel: ese
 *    generaría un id nuevo al insertar, y un registro creado offline ya trae el
 *    suyo. Si el id viene vacío, se genera aquí solo como red de seguridad.
 *
 * 2. Los borrados son soft. Un borrado duro haría que el dispositivo que estaba
 *    offline vuelva a subir la fila y el registro "reviva".
 *
 * 3. `rev` lo escribe el trigger piston_set_rev() en Postgres. Nunca se asigna
 *    desde PHP; por eso está en $guarded y fuera de $fillable.
 */
trait SyncsOffline
{
    use SoftDeletes;

    public function initializeSyncsOffline(): void
    {
        $this->casts = array_merge([
            'client_updated_at' => 'immutable_datetime',
            'rev' => 'integer',
        ], $this->casts);
    }

    public function getIncrementing(): bool
    {
        return false;
    }

    public function getKeyType(): string
    {
        return 'string';
    }

    protected static function bootSyncsOffline(): void
    {
        static::creating(function (self $model): void {
            if (blank($model->getKey())) {
                $model->setAttribute($model->getKeyName(), (string) Str::uuid7());
            }

            // Un cliente que no manda client_updated_at pierde todo desempate
            // de last-write-wins, así que se le pone un valor razonable.
            if (blank($model->client_updated_at)) {
                $model->client_updated_at = now();
            }
        });
    }

    /**
     * El corazón del sync delta: todo lo cambiado después de cierta revisión,
     * tombstones incluidos. Sin withTrashed() el cliente nunca se entera de los
     * borrados.
     */
    public function scopeSinceRev(Builder $query, int $rev): Builder
    {
        return $query->withTrashed()->where('rev', '>', $rev)->orderBy('rev');
    }
}
