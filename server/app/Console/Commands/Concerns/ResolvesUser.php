<?php

namespace App\Console\Commands\Concerns;

use App\Models\User;

use function Laravel\Prompts\search;

/**
 * Encuentra la cuenta sobre la que actúa un comando.
 *
 * Con correo como argumento se usa tal cual (útil en scripts). Sin él, se abre
 * un buscador interactivo por correo o nombre, para no tener que recordar el
 * correo exacto.
 */
trait ResolvesUser
{
    protected function resolveUser(?string $email): ?User
    {
        if (filled($email)) {
            $user = User::query()->where('email', mb_strtolower(trim($email)))->first();

            if ($user === null) {
                $this->components->error('No existe esa cuenta.');
            }

            return $user;
        }

        if (! $this->input->isInteractive()) {
            $this->components->error('Indica el correo de la cuenta.');

            return null;
        }

        if (! User::query()->exists()) {
            $this->components->error('Todavía no hay cuentas. Crea una con piston:user:create.');

            return null;
        }

        $id = search(
            label: 'Cuenta',
            options: fn (string $value) => User::query()
                ->when($value !== '', fn ($query) => $query
                    ->where('email', 'ilike', "%{$value}%")
                    ->orWhere('name', 'ilike', "%{$value}%"))
                ->orderBy('email')
                ->limit(10)
                ->get()
                ->mapWithKeys(fn (User $user) => [$user->id => "{$user->name} <{$user->email}>"])
                ->all(),
            placeholder: 'Escribe parte del correo o del nombre',
            hint: 'Flechas para elegir, Enter para confirmar.',
        );

        return User::query()->find($id);
    }
}
