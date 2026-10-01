<?php

namespace App\Http\Requests\Sync;

use App\Exceptions\ApiException;
use App\Http\Responses\ApiCode;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Solo la forma del lote. El payload de cada mutación se valida después, por
 * tabla y por separado: un payload malo rechaza su fila, no el lote entero.
 */
class SyncPushRequest extends FormRequest
{
    public const MAX_MUTATIONS = 500;

    protected function prepareForValidation(): void
    {
        // 413 y no 422: el cliente parte el lote en dos y reintenta.
        if (is_array($this->input('mutations')) && count($this->input('mutations')) > self::MAX_MUTATIONS) {
            throw ApiException::of(
                ApiCode::PayloadTooLarge,
                'Máximo '.self::MAX_MUTATIONS.' cambios por envío.',
            );
        }
    }

    public function rules(): array
    {
        return [
            'mutations' => ['present', 'array'],
            'mutations.*.table' => ['required', 'string', 'max:60'],
            'mutations.*.id' => ['required', 'uuid'],
            'mutations.*.op' => ['required', 'in:insert,update,delete'],
            'mutations.*.payload' => ['nullable', 'array'],
            // Sin `base_rev` la mutación usa el last-write-wins anterior.
            'mutations.*.base_rev' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'mutations.*.base' => ['sometimes', 'nullable', 'array'],
            'mutations.*.resolve' => ['sometimes', 'nullable', 'in:restore'],
        ];
    }
}
