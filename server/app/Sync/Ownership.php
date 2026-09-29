<?php

namespace App\Sync;

/** Cómo se sabe de quién es una fila. Decide qué se jala y qué se deja escribir. */
enum Ownership
{
    /** Tiene `user_id` obligatorio. */
    case User;

    /**
     * `user_id` nullable: NULL es un registro del sistema, visible para todos
     * y de solo lectura. Lo que sube un cliente siempre queda a su nombre.
     */
    case UserOrSystem;

    /** No tiene `user_id`: pertenece a quien sea dueño de la fila padre. */
    case Parent;
}
