<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\confirm;
use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

/**
 * Única forma de crear cuentas: no hay registro público.
 *
 * Sin argumentos abre un asistente interactivo. Con ellos no pregunta nada, y
 * así sirve también en scripts. La contraseña que se da aquí es temporal en
 * espíritu; el wizard de bienvenida invita a cambiarla en el primer inicio.
 */
#[Signature('piston:user:create {email? : Correo de la cuenta} {--name= : Nombre visible} {--password= : Contraseña (si se omite, se pide sin eco)}')]
#[Description('Crea una cuenta de Piston (interactivo si no se pasan datos)')]
class CreateUser extends Command
{
    public function handle(): int
    {
        $interactive = $this->input->isInteractive();

        $email = $this->argument('email') ?? ($interactive ? text(
            label: 'Correo',
            placeholder: 'tu@correo.com',
            required: true,
            validate: fn (string $value) => $this->firstError('email', mb_strtolower(trim($value))),
        ) : null);

        $name = $this->option('name') ?: ($interactive ? text(
            label: 'Nombre',
            placeholder: 'Como se mostrará en la app',
            required: true,
            validate: fn (string $value) => $this->firstError('name', $value),
        ) : null);

        $plain = $this->option('password') ?: ($interactive ? $this->askPassword() : null);

        $data = [
            'email' => mb_strtolower(trim((string) $email)),
            'name' => trim((string) $name),
            'password' => (string) $plain,
        ];

        $validator = Validator::make($data, $this->rules());
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->components->error($message);
            }

            return self::FAILURE;
        }

        if ($interactive && $this->argument('email') === null
            && ! confirm("¿Crear la cuenta {$data['email']} para {$data['name']}?", default: true)) {
            $this->components->warn('Cancelado.');

            return self::FAILURE;
        }

        $user = User::create($data);

        $this->components->info("Cuenta creada: {$user->email} ({$user->id})");

        return self::SUCCESS;
    }

    private function askPassword(): string
    {
        while (true) {
            $plain = password(
                label: 'Contraseña',
                placeholder: 'Mínimo 8 caracteres',
                required: true,
                validate: fn (string $value) => $this->firstError('password', $value),
                hint: 'Se le pedirá cambiarla en el primer inicio de sesión.',
            );

            if (password(label: 'Repite la contraseña', required: true) === $plain) {
                return $plain;
            }

            $this->components->error('Las contraseñas no coinciden.');
        }
    }

    /** @return array<string, array<int, mixed>> */
    private function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:180', 'unique:users,email'],
            'name' => ['required', 'string', 'max:120'],
            'password' => ['required', Password::min(8)],
        ];
    }

    /** Valida un solo campo al vuelo, para que el prompt avise antes de seguir. */
    private function firstError(string $field, string $value): ?string
    {
        return Validator::make([$field => $value], [$field => $this->rules()[$field]])
            ->errors()
            ->first($field) ?: null;
    }
}
