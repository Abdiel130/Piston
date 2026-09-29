<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Testing\TestResponse;

trait AuthTestHelpers
{
    protected const CLIENT = ['X-Piston-Client' => 'test', 'Accept' => 'application/json'];

    protected function makeUser(string $password = 'secreto-123'): User
    {
        return User::factory()->create(['email' => 'ana@example.com', 'password' => $password]);
    }

    protected function login(string $password = 'secreto-123'): TestResponse
    {
        return $this->withHeaders(self::CLIENT)->postJson('/api/auth/login', [
            'email' => 'ana@example.com',
            'password' => $password,
            'device_name' => 'Pixel',
        ]);
    }

    protected function refreshWith(string $cookie): TestResponse
    {
        // Cada petición de prueba reusa el mismo Application; se limpia el
        // guard para que no arrastre el usuario de la petición anterior.
        $this->app['auth']->forgetGuards();

        // withCredentials: sin él, las peticiones JSON de prueba no mandan cookies.
        return $this->withHeaders(self::CLIENT)
            ->withCredentials()
            ->withUnencryptedCookie('piston_refresh', $cookie)
            ->postJson('/api/auth/refresh');
    }

    protected function refreshCookie(TestResponse $response): string
    {
        $cookie = $response->getCookie('piston_refresh', decrypt: false);
        $this->assertNotNull($cookie, 'La respuesta no trae la cookie del refresh.');

        return $cookie->getValue();
    }

    protected function authed(string $accessToken): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withHeaders(self::CLIENT + ['Authorization' => "Bearer {$accessToken}"]);
    }
}
