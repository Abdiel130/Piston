<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LogoutTest extends TestCase
{
    use AuthTestHelpers, RefreshDatabase;

    public function test_logout_kills_access_and_refresh_and_clears_cookie(): void
    {
        $this->makeUser();
        $login = $this->login();
        $access = $login->json('data.access_token');
        $cookie = $this->refreshCookie($login);

        $response = $this->authed($access)
            ->withCredentials()
            ->withUnencryptedCookie('piston_refresh', $cookie)
            ->postJson('/api/auth/logout')
            ->assertOk();

        $this->assertSame('', $response->getCookie('piston_refresh', decrypt: false)->getValue());

        $this->authed($access)->getJson('/api/me')->assertUnauthorized();
        $this->refreshWith($cookie)->assertUnauthorized();
    }

    public function test_logout_only_closes_its_own_session(): void
    {
        $this->makeUser();
        $phone = $this->login();
        $laptop = $this->login();

        $this->authed($phone->json('data.access_token'))->postJson('/api/auth/logout')->assertOk();

        $this->authed($laptop->json('data.access_token'))->getJson('/api/me')->assertOk();
        $this->refreshWith($this->refreshCookie($laptop))->assertOk();
    }
}
