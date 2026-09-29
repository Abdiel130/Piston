<?php

namespace App\Services\Auth;

use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * Lo que sale de un login o de un refresh. Los valores en claro existen solo
 * aquí, de camino a la respuesta: en la base de datos quedan sus hashes.
 */
final readonly class IssuedTokens
{
    public function __construct(
        public User $user,
        public string $accessToken,
        public CarbonImmutable $accessExpiresAt,
        public string $refreshToken,
        public CarbonImmutable $refreshExpiresAt,
        public string $familyId,
    ) {}
}
