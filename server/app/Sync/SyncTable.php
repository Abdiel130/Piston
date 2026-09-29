<?php

namespace App\Sync;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * Lo que el sync necesita saber de una tabla de dominio.
 *
 * @template TModel of Model
 */
final readonly class SyncTable
{
    /**
     * @param  class-string<TModel>  $model
     * @param  array<string, Field>  $fields  Columnas que el cliente puede escribir.
     * @param  array<string, string>|null  $polymorphicOwner  `owner_type` → tabla, para adjuntos.
     */
    public function __construct(
        public string $name,
        public string $model,
        public Ownership $ownership,
        public array $fields,
        public ?string $parentColumn = null,
        public ?array $polymorphicOwner = null,
    ) {
        if ($ownership === Ownership::Parent && $parentColumn === null) {
            throw new InvalidArgumentException("{$name}: una tabla hija necesita parentColumn.");
        }
    }

    /** @return Builder<TModel> */
    public function query(): Builder
    {
        return $this->model::query()->withTrashed();
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return array_map(fn (Field $field) => $field->rules(), $this->fields);
    }

    /** @return array<string, string> */
    public function casts(): array
    {
        return array_filter(array_map(fn (Field $field) => $field->cast(), $this->fields));
    }

    /** Tabla a la que apunta `parentColumn`, sacada de su propio `Field::ref`. */
    public function parentTable(): ?string
    {
        return $this->parentColumn ? $this->fields[$this->parentColumn]->references : null;
    }

    /** @return array<string, string> columna → tabla referenciada */
    public function references(): array
    {
        return array_filter(array_map(fn (Field $field) => $field->references, $this->fields));
    }

    public function hasUserColumn(): bool
    {
        return $this->ownership !== Ownership::Parent;
    }
}
