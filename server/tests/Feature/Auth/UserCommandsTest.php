<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserCommandsTest extends TestCase
{
    use AuthTestHelpers, RefreshDatabase;

    public function test_create_user(): void
    {
        $this->artisan('piston:user:create', [
            'email' => 'Beto@Example.com', '--name' => 'Beto', '--password' => 'clave-segura',
        ])->assertSuccessful();

        $user = User::query()->where('email', 'beto@example.com')->firstOrFail();
        $this->assertTrue(Hash::check('clave-segura', $user->password));
        $this->assertSame('account', $user->onboarding_step->value);
    }

    public function test_create_user_rejects_duplicates_and_short_passwords(): void
    {
        $this->makeUser();

        $this->artisan('piston:user:create', [
            'email' => 'ana@example.com', '--name' => 'Ana', '--password' => 'clave-segura',
        ])->assertFailed();

        $this->artisan('piston:user:create', [
            'email' => 'otra@example.com', '--name' => 'Otra', '--password' => 'corta',
        ])->assertFailed();
    }

    public function test_password_reset_revokes_every_session(): void
    {
        $this->makeUser();
        $login = $this->login();

        $this->artisan('piston:user:password', ['email' => 'ana@example.com', '--password' => 'otra-clave-9'])
            ->assertSuccessful();

        $this->authed($login->json('data.access_token'))->getJson('/api/me')->assertUnauthorized();
        $this->refreshWith($this->refreshCookie($login))->assertUnauthorized();
        $this->login('otra-clave-9')->assertOk();
    }

    public function test_revoke_closes_every_session(): void
    {
        $this->makeUser();
        $login = $this->login();

        $this->artisan('piston:user:revoke', ['email' => 'ana@example.com'])->assertSuccessful();

        $this->refreshWith($this->refreshCookie($login))->assertUnauthorized();
    }

    public function test_create_user_interactively(): void
    {
        $this->artisan('piston:user:create')
            ->expectsQuestion('Correo', 'Carla@Example.com')
            ->expectsQuestion('Nombre', 'Carla')
            ->expectsQuestion('Contraseña', 'clave-segura')
            ->expectsQuestion('Repite la contraseña', 'clave-segura')
            ->expectsConfirmation('¿Crear la cuenta carla@example.com para Carla?', 'yes')
            ->assertSuccessful();

        $this->assertTrue(Hash::check('clave-segura', User::query()->where('email', 'carla@example.com')->value('password')));
    }

    public function test_interactive_create_asks_again_when_passwords_differ(): void
    {
        $this->artisan('piston:user:create')
            ->expectsQuestion('Correo', 'dani@example.com')
            ->expectsQuestion('Nombre', 'Dani')
            ->expectsQuestion('Contraseña', 'clave-segura')
            ->expectsQuestion('Repite la contraseña', 'otra-cosa')
            ->expectsOutputToContain('Las contraseñas no coinciden.')
            ->expectsQuestion('Contraseña', 'clave-segura')
            ->expectsQuestion('Repite la contraseña', 'clave-segura')
            ->expectsConfirmation('¿Crear la cuenta dani@example.com para Dani?', 'yes')
            ->assertSuccessful();
    }

    public function test_interactive_password_reset_picks_the_account_from_a_list(): void
    {
        $user = $this->makeUser();

        $this->artisan('piston:user:password')
            ->expectsSearch('Cuenta', $user->id, 'ana', [$user->id => "{$user->name} <ana@example.com>"])
            ->expectsQuestion('Nueva contraseña', 'otra-clave-9')
            ->expectsQuestion('Repite la contraseña', 'otra-clave-9')
            ->assertSuccessful();

        $this->assertTrue(Hash::check('otra-clave-9', $user->fresh()->password));
    }

    public function test_interactive_revoke_asks_for_confirmation(): void
    {
        $user = $this->makeUser();
        $login = $this->login();

        $this->artisan('piston:user:revoke')
            ->expectsSearch('Cuenta', $user->id, 'ana', [$user->id => "{$user->name} <ana@example.com>"])
            ->expectsConfirmation('¿Cerrar TODAS las sesiones de ana@example.com? Tendrá que volver a iniciar sesión en cada dispositivo.', 'no')
            ->assertFailed();

        $this->refreshWith($this->refreshCookie($login))->assertOk();
    }

    public function test_commands_without_arguments_fail_cleanly_when_not_interactive(): void
    {
        $this->artisan('piston:user:revoke', ['--no-interaction' => true])->assertFailed();
    }
}
