<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

class LoginTest extends TestCase
{
    use AuthTestHelpers, RefreshDatabase;

    public function test_login_returns_access_token_in_body_and_refresh_only_in_http_only_cookie(): void
    {
        $this->makeUser();

        $response = $this->login()->assertOk()
            ->assertJsonPath('data.token_type', 'Bearer')
            ->assertJsonPath('data.user.email', 'ana@example.com')
            ->assertJsonPath('data.user.onboarding.step', 'account')
            ->assertJsonMissingPath('data.refresh_token');

        $this->assertSame(900, $response->json('data.expires_in'));

        $cookie = $response->getCookie('piston_refresh', decrypt: false);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame(Cookie::SAMESITE_STRICT, $cookie->getSameSite());
        $this->assertSame('/api/auth', $cookie->getPath());
        $this->assertDatabaseCount('refresh_tokens', 1);
        $this->assertDatabaseMissing('refresh_tokens', ['token_hash' => $cookie->getValue()]);
    }

    public function test_wrong_password_and_unknown_email_get_the_same_error(): void
    {
        $this->makeUser();

        $this->login('otra-cosa')->assertUnprocessable()->assertJsonValidationErrors('email');

        $this->withHeaders(self::CLIENT)
            ->postJson('/api/auth/login', ['email' => 'nadie@example.com', 'password' => 'x'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'El correo o la contraseña no son correctos.');
    }

    public function test_email_is_case_insensitive(): void
    {
        $this->makeUser();

        $this->withHeaders(self::CLIENT)
            ->postJson('/api/auth/login', ['email' => '  ANA@Example.com ', 'password' => 'secreto-123'])
            ->assertOk();
    }

    public function test_login_is_throttled(): void
    {
        $this->makeUser();

        for ($i = 0; $i < 5; $i++) {
            $this->login('mala')->assertUnprocessable();
        }

        $this->login()->assertTooManyRequests();
    }

    public function test_auth_routes_require_client_header(): void
    {
        $this->makeUser();

        $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'secreto-123'])
            ->assertForbidden()
            ->assertJsonPath('code', 'client_header_missing');
    }

    public function test_access_token_opens_protected_routes(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)->getJson('/api/me')->assertOk()->assertJsonPath('data.email', 'ana@example.com');
    }

    public function test_missing_or_expired_access_token_returns_unauthenticated_code(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->getJson('/api/me')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');

        $this->travel(16)->minutes();

        $this->authed($token)->getJson('/api/me')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
    }
}
