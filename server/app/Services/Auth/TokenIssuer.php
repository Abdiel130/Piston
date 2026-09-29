<?php

namespace App\Services\Auth;

use App\Models\RefreshToken;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Emite, rota y revoca los pares access/refresh.
 *
 * Toda la política de sesiones vive aquí para que los controladores no tengan
 * que saber nada de familias, hashes ni ventanas de gracia.
 */
class TokenIssuer
{
    /** Abre una familia nueva. Se llama al iniciar sesión. */
    public function issue(User $user, Request $request, ?string $deviceName = null): IssuedTokens
    {
        return DB::transaction(
            fn () => $this->mint($user, (string) Str::uuid7(), $request, $deviceName),
        );
    }

    /**
     * Cambia un refresh token por un par nuevo de la misma familia.
     *
     * @throws InvalidRefreshToken
     * @throws RefreshTokenRace
     */
    public function rotate(string $plain, Request $request): IssuedTokens
    {
        $stolenFamily = null;

        $issued = DB::transaction(function () use ($plain, $request, &$stolenFamily) {
            $current = RefreshToken::query()
                ->where('token_hash', RefreshToken::hash($plain))
                ->lockForUpdate()
                ->first();

            if ($current === null) {
                throw new InvalidRefreshToken('Refresh token desconocido.');
            }

            if ($current->revoked_at !== null) {
                $this->rejectRevoked($current);
                // Reuso fuera de la gracia. La revocación NO puede ir aquí
                // dentro: la excepción desharía la transacción y con ella la
                // revocación. Se marca y se hace después del commit.
                $stolenFamily = $current->family_id;

                return null;
            }

            if ($current->expires_at->isPast()) {
                throw new InvalidRefreshToken('Refresh token expirado.');
            }

            $now = now();
            $current->forceFill([
                'revoked_at' => $now,
                'replaced_at' => $now,
                'last_used_at' => $now,
            ])->save();

            return $this->mint(
                $current->user,
                $current->family_id,
                $request,
                $current->device_name,
            );
        });

        if ($stolenFamily !== null) {
            $this->revokeFamily($stolenFamily);

            throw new InvalidRefreshToken('Reuso de refresh token detectado; sesión revocada.');
        }

        return $issued;
    }

    /** Cierra una sesión: su refresh deja de rotar y sus access tokens mueren ya. */
    public function revokeFamily(string $familyId): void
    {
        RefreshToken::query()
            ->where('family_id', $familyId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        PersonalAccessToken::query()->where('refresh_family_id', $familyId)->delete();
    }

    /** Cierra todas las sesiones de un usuario, salvo la indicada. */
    public function revokeAll(User $user, ?string $exceptFamilyId = null): void
    {
        $families = RefreshToken::query()
            ->where('user_id', $user->getKey())
            ->when($exceptFamilyId, fn ($query) => $query->where('family_id', '!=', $exceptFamilyId))
            ->distinct()
            ->pluck('family_id');

        foreach ($families as $familyId) {
            $this->revokeFamily($familyId);
        }

        // Access tokens sin familia (emitidos a mano, p. ej. desde tinker).
        $user->tokens()->whereNull('refresh_family_id')->delete();
    }

    /** Familia a la que pertenece el access token con el que se autenticó la petición. */
    public function familyOf(User $user): ?string
    {
        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken ? $token->refresh_family_id : null;
    }

    /** Familia de un refresh token en claro, si existe. */
    public function familyOfRefresh(string $plain): ?string
    {
        return RefreshToken::query()
            ->where('token_hash', RefreshToken::hash($plain))
            ->value('family_id');
    }

    /**
     * Un token revocado que vuelve a aparecer.
     *
     * - Revocado por logout: simplemente ya no sirve.
     * - Rotado hace segundos: carrera entre pestañas, se pide reintentar.
     * - Rotado hace más: alguien guardó una copia. Regresa sin lanzar para que
     *   quien llama queme la familia entera.
     */
    private function rejectRevoked(RefreshToken $token): void
    {
        if ($token->replaced_at === null) {
            throw new InvalidRefreshToken('Sesión cerrada.');
        }

        $grace = (int) config('piston.auth.reuse_grace_seconds');
        if ($token->replaced_at->diffInSeconds(now(), absolute: true) <= $grace) {
            throw new RefreshTokenRace('El token se acaba de rotar.');
        }
    }

    private function mint(User $user, string $familyId, Request $request, ?string $deviceName): IssuedTokens
    {
        $now = CarbonImmutable::now();
        $accessExpiresAt = $now->addMinutes((int) config('piston.auth.access_ttl_minutes'));
        $refreshExpiresAt = $now->addDays((int) config('piston.auth.refresh_ttl_days'));

        $access = $user->createToken($deviceName ?? 'piston', ['*'], $accessExpiresAt);
        $access->accessToken->forceFill(['refresh_family_id' => $familyId])->save();

        $refreshPlain = Str::random(64);
        RefreshToken::create([
            'user_id' => $user->getKey(),
            'family_id' => $familyId,
            'token_hash' => RefreshToken::hash($refreshPlain),
            'device_name' => $deviceName,
            'user_agent' => Str::limit((string) $request->userAgent(), 500, ''),
            'ip_address' => $request->ip(),
            'expires_at' => $refreshExpiresAt,
            'last_used_at' => $now,
        ]);

        return new IssuedTokens(
            user: $user,
            accessToken: $access->plainTextToken,
            accessExpiresAt: $accessExpiresAt,
            refreshToken: $refreshPlain,
            refreshExpiresAt: $refreshExpiresAt,
            familyId: $familyId,
        );
    }
}
