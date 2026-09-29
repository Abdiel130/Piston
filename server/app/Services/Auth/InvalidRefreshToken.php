<?php

namespace App\Services\Auth;

use RuntimeException;

/** El refresh no sirve: no existe, expiró, se revocó o se detectó reuso. */
class InvalidRefreshToken extends RuntimeException {}
