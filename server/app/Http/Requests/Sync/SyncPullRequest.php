<?php

namespace App\Http\Requests\Sync;

use Illuminate\Foundation\Http\FormRequest;

class SyncPullRequest extends FormRequest
{
    public const DEFAULT_LIMIT = 500;

    public function rules(): array
    {
        return [
            'since' => ['sometimes', 'integer', 'min:0'],
            'limit' => ['sometimes', 'integer', 'between:1,1000'],
        ];
    }

    public function since(): int
    {
        return (int) $this->validated('since', 0);
    }

    public function limit(): int
    {
        return (int) $this->validated('limit', self::DEFAULT_LIMIT);
    }
}
