<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'locale', 'currency', 'distance_unit', 'volume_unit'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /**
     * A diferencia de las entidades de dominio, el usuario SÍ se crea en el
     * servidor (al registrarse hay conexión por definición), así que aquí
     * HasUuids es correcto.
     */
    use HasApiTokens, HasFactory, HasUuids, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }
}
