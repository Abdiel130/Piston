<?php

namespace App\Services\Auth;

use RuntimeException;

/**
 * El token se acaba de rotar, dentro de la ventana de gracia.
 *
 * Casi siempre son dos pestañas refrescando a la vez: la otra ya dejó la cookie
 * nueva en el navegador, así que al cliente le basta con reintentar.
 */
class RefreshTokenRace extends RuntimeException {}
