<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin User */
class UserResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'locale' => $this->locale,
            'currency' => $this->currency,
            'distance_unit' => $this->distance_unit,
            'volume_unit' => $this->volume_unit,
            'onboarding' => [
                'step' => $this->onboarding_step->value,
                'draft' => $this->onboarding_draft,
                'updated_at' => $this->onboarding_updated_at?->toIso8601ZuluString('millisecond'),
                'completed_at' => $this->onboarding_completed_at?->toIso8601ZuluString('millisecond'),
            ],
        ];
    }
}
