<?php

namespace App\Enums;

/**
 * Pasos del wizard de bienvenida, en orden.
 *
 * El frontend tiene la misma lista; si se agrega un paso, va en ambos lados.
 */
enum OnboardingStep: string
{
    case Account = 'account';
    case Vehicle = 'vehicle';
    case Tank = 'tank';
    case Purchase = 'purchase';
    case Review = 'review';
    case Done = 'done';
}
