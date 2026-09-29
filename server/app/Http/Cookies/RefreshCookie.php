<?php

namespace App\Http\Cookies;

use DateTimeInterface;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * La cookie que transporta el refresh token. Único lugar que conoce su forma.
 *
 * HttpOnly: el JavaScript no puede leerla, así que un XSS no se la lleva.
 * SameSite=Strict + Path=/api/auth: solo viaja a las rutas de auth y solo
 * desde nuestro propio sitio.
 */
final class RefreshCookie
{
    public static function issue(string $plain, DateTimeInterface $expiresAt): Cookie
    {
        return self::make($plain, $expiresAt->getTimestamp());
    }

    /** Le pide al navegador que la borre. */
    public static function forget(): Cookie
    {
        return self::make('', 1);
    }

    public static function read(Request $request): ?string
    {
        $value = $request->cookie(config('piston.auth.cookie.name'));

        return is_string($value) && $value !== '' ? $value : null;
    }

    private static function make(string $value, int $expiresAt): Cookie
    {
        $config = config('piston.auth.cookie');

        return Cookie::create(
            name: $config['name'],
            value: $value,
            expire: $expiresAt,
            path: $config['path'],
            secure: $config['secure'],
            httpOnly: true,
            raw: false,
            sameSite: Cookie::SAMESITE_STRICT,
        );
    }
}
