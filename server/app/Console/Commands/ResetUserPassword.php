<?php

namespace App\Console\Commands;

use App\Console\Commands\Concerns\ResolvesUser;
use App\Services\Auth\TokenIssuer;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\password;

/**
 * Reemplaza la recuperación por correo mientras no exista. Cierra todas las
 * sesiones: si alguien pide un reset, es que la contraseña vieja no es de fiar.
 */
#[Signature('piston:user:password {email? : Correo de la cuenta (si se omite, se elige de una lista)} {--password= : Nueva contraseña (si se omite, se pide sin eco)}')]
#[Description('Cambia la contraseña de una cuenta y cierra todas sus sesiones')]
class ResetUserPassword extends Command
{
    use ResolvesUser;

    public function handle(TokenIssuer $issuer): int
    {
        $user = $this->resolveUser($this->argument('email'));
        if ($user === null) {
            return self::FAILURE;
        }

        $plain = $this->option('password') ?: ($this->input->isInteractive() ? $this->askPassword() : '');

        $validator = Validator::make(['password' => $plain], ['password' => ['required', Password::min(8)]]);
        if ($validator->fails()) {
            $this->components->error($validator->errors()->first());

            return self::FAILURE;
        }

        $user->forceFill(['password' => $plain])->save();
        $issuer->revokeAll($user);

        $this->components->info("Contraseña actualizada y sesiones cerradas para {$user->email}.");

        return self::SUCCESS;
    }

    private function askPassword(): string
    {
        while (true) {
            $plain = password(
                label: 'Nueva contraseña',
                placeholder: 'Mínimo 8 caracteres',
                required: true,
                validate: fn (string $value) => mb_strlen($value) < 8 ? 'Mínimo 8 caracteres.' : null,
            );

            if (password(label: 'Repite la contraseña', required: true) === $plain) {
                return $plain;
            }

            $this->components->error('Las contraseñas no coinciden.');
        }
    }
}
