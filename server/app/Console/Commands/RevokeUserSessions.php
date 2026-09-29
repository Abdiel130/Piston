<?php

namespace App\Console\Commands;

use App\Console\Commands\Concerns\ResolvesUser;
use App\Services\Auth\TokenIssuer;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

use function Laravel\Prompts\confirm;

/**
 * Para un dispositivo perdido. Los datos locales de ese dispositivo no se
 * pueden borrar a distancia, pero deja de poder leer o escribir en el servidor.
 */
#[Signature('piston:user:revoke {email? : Correo de la cuenta (si se omite, se elige de una lista)}')]
#[Description('Cierra todas las sesiones de una cuenta')]
class RevokeUserSessions extends Command
{
    use ResolvesUser;

    public function handle(TokenIssuer $issuer): int
    {
        $user = $this->resolveUser($this->argument('email'));
        if ($user === null) {
            return self::FAILURE;
        }

        if ($this->argument('email') === null
            && ! confirm("¿Cerrar TODAS las sesiones de {$user->email}? Tendrá que volver a iniciar sesión en cada dispositivo.", default: false)) {
            $this->components->warn('Cancelado.');

            return self::FAILURE;
        }

        $issuer->revokeAll($user);

        $this->components->info("Sesiones cerradas para {$user->email}.");

        return self::SUCCESS;
    }
}
