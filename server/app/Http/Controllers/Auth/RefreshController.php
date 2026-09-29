<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Cookies\RefreshCookie;
use App\Http\Resources\SessionResource;
use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use App\Services\Auth\InvalidRefreshToken;
use App\Services\Auth\RefreshTokenRace;
use App\Services\Auth\TokenIssuer;
use Illuminate\Http\Request;

class RefreshController extends Controller
{
    public function __invoke(Request $request, TokenIssuer $issuer): ApiResponse
    {
        $plain = RefreshCookie::read($request);

        if ($plain === null) {
            return $this->invalid();
        }

        try {
            $tokens = $issuer->rotate($plain, $request);
        } catch (RefreshTokenRace) {
            // Sin tocar la cookie: la que ya tiene el navegador es la buena.
            return ApiResponse::error(ApiCode::RefreshRace);
        } catch (InvalidRefreshToken) {
            // El motivo (expirado, revocado, reuso) no se le dice al cliente:
            // para él todos significan lo mismo, volver a iniciar sesión.
            return $this->invalid();
        }

        return ApiResponse::success(new SessionResource($tokens))
            ->withCookie(RefreshCookie::issue($tokens->refreshToken, $tokens->refreshExpiresAt));
    }

    private function invalid(): ApiResponse
    {
        return ApiResponse::error(ApiCode::RefreshInvalid)->withCookie(RefreshCookie::forget());
    }
}
