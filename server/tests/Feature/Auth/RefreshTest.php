<?php

namespace Tests\Feature\Auth;

use App\Models\RefreshToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RefreshTest extends TestCase
{
    use AuthTestHelpers, RefreshDatabase;

    public function test_refresh_rotates_the_cookie_and_issues_a_new_access_token(): void
    {
        $this->makeUser();
        $login = $this->login();
        $first = $this->refreshCookie($login);

        $refreshed = $this->refreshWith($first)->assertOk();
        $second = $this->refreshCookie($refreshed);

        $this->assertNotSame($first, $second);
        $this->assertNotSame($login->json('data.access_token'), $refreshed->json('data.access_token'));

        $old = RefreshToken::query()->where('token_hash', RefreshToken::hash($first))->first();
        $new = RefreshToken::query()->where('token_hash', RefreshToken::hash($second))->first();
        $this->assertNotNull($old->revoked_at);
        $this->assertNotNull($old->replaced_at);
        $this->assertSame($old->family_id, $new->family_id);
        $this->assertNull($new->revoked_at);
    }

    public function test_reuse_inside_grace_window_is_a_race_not_a_theft(): void
    {
        $this->makeUser();
        $first = $this->refreshCookie($this->login());
        $second = $this->refreshCookie($this->refreshWith($first));

        $this->refreshWith($first)->assertStatus(409)->assertJsonPath('code', 'refresh_race');

        // La familia sigue viva: el token vigente todavía rota.
        $this->refreshWith($second)->assertOk();
    }

    public function test_reuse_after_grace_window_revokes_the_whole_family(): void
    {
        $this->makeUser();
        $login = $this->login();
        $first = $this->refreshCookie($login);
        $refreshed = $this->refreshWith($first);
        $second = $this->refreshCookie($refreshed);

        $this->travel(11)->seconds();

        $this->refreshWith($first)->assertUnauthorized()->assertJsonPath('code', 'refresh_invalid');

        // El legítimo también cae, y sus access tokens dejan de servir ya.
        $this->refreshWith($second)->assertUnauthorized();
        $this->authed($refreshed->json('data.access_token'))->getJson('/api/me')->assertUnauthorized();
    }

    public function test_expired_refresh_is_rejected(): void
    {
        $this->makeUser();
        $cookie = $this->refreshCookie($this->login());

        $this->travel(61)->days();

        $this->refreshWith($cookie)->assertUnauthorized();
    }

    public function test_refresh_is_sliding(): void
    {
        $this->makeUser();
        $cookie = $this->refreshCookie($this->login());

        // Usar la app cada 50 días mantiene viva la sesión indefinidamente.
        foreach (range(1, 3) as $ignored) {
            $this->travel(50)->days();
            $cookie = $this->refreshCookie($this->refreshWith($cookie)->assertOk());
        }
    }

    public function test_missing_or_unknown_cookie_is_unauthenticated(): void
    {
        $this->withHeaders(self::CLIENT)->postJson('/api/auth/refresh')->assertUnauthorized();
        $this->refreshWith('inventado')->assertUnauthorized();
    }
}
