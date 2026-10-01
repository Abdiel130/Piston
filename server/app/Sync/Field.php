<?php

namespace App\Sync;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Una columna sincronizable: de aquí salen la validación del push y el cast
 * con el que la fila vuelve al cliente en el pull.
 *
 * Tenerlo en un solo lugar evita la deriva clásica: validar `decimal(6,2)` en
 * un lado y devolver el valor como string en el otro, o aceptar un enum que la
 * columna de Postgres rechaza con un error que parece del servidor.
 */
final readonly class Field
{
    /** @param  list<string>|null  $values */
    private function __construct(
        public string $type,
        public bool $nullable = false,
        public bool $hasDefault = false,
        public ?int $max = null,
        public ?int $precision = null,
        public ?int $scale = null,
        public ?array $values = null,
        public ?string $references = null,
    ) {}

    public static function string(int $max): self
    {
        return new self('string', max: $max);
    }

    public static function text(): self
    {
        return new self('string', max: 10_000);
    }

    public static function integer(): self
    {
        return new self('integer');
    }

    public static function smallInteger(): self
    {
        return new self('smallint');
    }

    public static function decimal(int $precision, int $scale): self
    {
        return new self('decimal', precision: $precision, scale: $scale);
    }

    public static function boolean(): self
    {
        return new self('boolean');
    }

    public static function date(): self
    {
        return new self('date');
    }

    public static function dateTime(): self
    {
        return new self('datetime');
    }

    /** @param  list<string>  $values */
    public static function enum(array $values): self
    {
        return new self('enum', values: $values);
    }

    public static function uuid(): self
    {
        return new self('uuid');
    }

    /** Llave foránea a otra tabla sincronizable. El push verifica que exista y sea del usuario. */
    public static function ref(string $table): self
    {
        return new self('uuid', references: $table);
    }

    public function nullable(): self
    {
        return $this->copy(nullable: true);
    }

    /** La columna tiene default en Postgres: el cliente puede omitirla, pero no mandarla en null. */
    public function withDefault(): self
    {
        return $this->copy(hasDefault: true);
    }

    /** @return list<mixed> */
    public function rules(): array
    {
        $presence = match (true) {
            $this->nullable => ['nullable'],
            $this->hasDefault => ['sometimes'],
            default => ['required'],
        };

        return [...$presence, ...$this->typeRules()];
    }

    /** Cast de Eloquent para que el JSON del pull lleve el tipo que espera el cliente. */
    public function cast(): ?string
    {
        return match ($this->type) {
            'integer', 'smallint' => 'integer',
            'decimal' => 'float',
            'boolean' => 'boolean',
            'date' => 'date:Y-m-d',
            'datetime' => 'immutable_datetime',
            default => null,
        };
    }

    /**
     * El valor en una forma comparable, venga del cliente (JSON) o de la fila
     * (cast de Eloquent). Sin esto `12.5` contra `"12.50"`, o una fecha con y
     * sin microsegundos, parecerían cambios distintos y el merge inventaría
     * conflictos.
     */
    public function normalize(mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }

        return match ($this->type) {
            'integer', 'smallint' => is_numeric($value) ? (int) $value : $value,
            'decimal' => is_numeric($value)
                ? number_format(round((float) $value, $this->scale ?? 0), $this->scale ?? 0, '.', '')
                : $value,
            'boolean' => filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $value,
            'date' => $this->moment($value, 'Y-m-d'),
            'datetime' => $this->moment($value, 'Y-m-d\\TH:i:s.v'),
            'uuid' => is_string($value) ? strtolower($value) : $value,
            default => is_scalar($value) ? (string) $value : $value,
        };
    }

    public function same(mixed $a, mixed $b): bool
    {
        return $this->normalize($a) === $this->normalize($b);
    }

    /** Fechas a milisegundos y UTC: es la precisión que maneja el cliente. */
    private function moment(mixed $value, string $format): mixed
    {
        try {
            $moment = $value instanceof DateTimeInterface
                ? CarbonImmutable::instance($value)
                : CarbonImmutable::parse((string) $value);
        } catch (Throwable) {
            return $value;
        }

        return ($this->type === 'date' ? $moment : $moment->utc())->format($format);
    }

    /** @return list<mixed> */
    private function typeRules(): array
    {
        return match ($this->type) {
            'string' => ['string', "max:{$this->max}"],
            'integer' => ['integer', 'between:-2147483648,2147483647'],
            'smallint' => ['integer', 'between:-32768,32767'],
            'decimal' => ['numeric', "decimal:0,{$this->scale}", ...$this->decimalRange()],
            'boolean' => ['boolean'],
            'date' => ['date_format:Y-m-d'],
            'datetime' => ['date'],
            'enum' => [Rule::in($this->values ?? [])],
            'uuid' => ['uuid'],
        };
    }

    /**
     * Postgres rechaza con "numeric field overflow" lo que no cabe en la
     * columna. Validarlo aquí convierte ese 500 en un rechazo con campo.
     *
     * @return list<string>
     */
    private function decimalRange(): array
    {
        $limit = 10 ** (($this->precision ?? 0) - ($this->scale ?? 0)) - 10 ** -($this->scale ?? 0);
        $bound = rtrim(rtrim(number_format($limit, $this->scale ?? 0, '.', ''), '0'), '.');

        return ["between:-{$bound},{$bound}"];
    }

    private function copy(?bool $nullable = null, ?bool $hasDefault = null): self
    {
        return new self(
            type: $this->type,
            nullable: $nullable ?? $this->nullable,
            hasDefault: $hasDefault ?? $this->hasDefault,
            max: $this->max,
            precision: $this->precision,
            scale: $this->scale,
            values: $this->values,
            references: $this->references,
        );
    }
}
