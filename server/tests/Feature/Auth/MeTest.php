<?php

namespace Tests\Feature\Auth;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class MeTest extends TestCase
{
    use AuthTestHelpers, RefreshDatabase;

    public function test_profile_can_be_updated(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)
            ->patchJson('/api/me', ['name' => 'Ana María', 'distance_unit' => 'mi'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Ana María')
            ->assertJsonPath('data.distance_unit', 'mi');

        $this->authed($token)->patchJson('/api/me', ['currency' => 'PESOS'])->assertUnprocessable();
    }

    public function test_password_change_keeps_current_session_and_closes_the_others(): void
    {
        $user = $this->makeUser();
        $phone = $this->login();
        $laptop = $this->login();

        $this->authed($phone->json('data.access_token'))
            ->putJson('/api/me/password', ['current_password' => 'secreto-123', 'password' => 'nueva-clave-1'])
            ->assertOk();

        $this->assertTrue(Hash::check('nueva-clave-1', $user->fresh()->password));
        $this->authed($phone->json('data.access_token'))->getJson('/api/me')->assertOk();
        $this->refreshWith($this->refreshCookie($phone))->assertOk();
        $this->authed($laptop->json('data.access_token'))->getJson('/api/me')->assertUnauthorized();
        $this->refreshWith($this->refreshCookie($laptop))->assertUnauthorized();
    }

    public function test_password_change_requires_the_current_one(): void
    {
        $this->makeUser();
        $token = $this->login()->json('data.access_token');

        $this->authed($token)
            ->putJson('/api/me/password', ['current_password' => 'mala', 'password' => 'nueva-clave-1'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('current_password');
    }
}
