<?php

namespace App\Http\Requests;

use App\Enums\OnboardingStep;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateOnboardingRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            // `done` solo se alcanza por POST /complete, nunca por aquí.
            'step' => ['required', Rule::enum(OnboardingStep::class)->except([OnboardingStep::Done])],
            'draft' => ['present', 'nullable', 'array'],
            'updated_at' => ['required', 'date'],
        ];
    }
}
