<?php

namespace App\Http\Resources;

use App\Services\Auth\IssuedTokens;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Lo que devuelven login y refresh.
 *
 * El access token va aquí (el cliente lo guarda en memoria); el refresh
 * NUNCA: viaja solo en la cookie HttpOnly.
 *
 * @mixin IssuedTokens
 */
class SessionResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        return [
            'access_token' => $this->accessToken,
            'token_type' => 'Bearer',
            'expires_in' => (int) config('piston.auth.access_ttl_minutes') * 60,
            'expires_at' => $this->accessExpiresAt->toIso8601ZuluString('millisecond'),
            'user' => (new UserResource($this->user))->resolve($request),
        ];
    }
}
