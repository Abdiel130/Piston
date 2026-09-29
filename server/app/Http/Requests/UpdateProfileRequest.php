<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProfileRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'locale' => ['sometimes', 'required', 'string', 'max:10'],
            'currency' => ['sometimes', 'required', 'string', 'size:3'],
            'distance_unit' => ['sometimes', 'required', Rule::in(['km', 'mi'])],
            'volume_unit' => ['sometimes', 'required', Rule::in(['L', 'gal'])],
        ];
    }
}
