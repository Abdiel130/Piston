<?php

namespace App\Http\Controllers\Auth;

use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Cookies\RefreshCookie;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\SessionResource;
use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use App\Models\User;
use App\Services\Auth\TokenIssuer;
use Illuminate\Support\Facades\Hash;

class LoginController extends Controller
{
    public function __invoke(LoginRequest $request, TokenIssuer $issuer): ApiResponse
    {
        $user = User::query()->where('email', $request->validated('email'))->first();

        // Mismo mensaje para "no existe" y "contraseña mala": distinguirlos
        // le diría a un atacante qué correos tienen cuenta. Va también en
        // `errors.email` para que el formulario lo pinte junto al campo.
        if ($user === null || ! Hash::check($request->validated('password'), $user->password)) {
            throw ApiException::of(ApiCode::InvalidCredentials, errors: [
                'email' => [ApiCode::InvalidCredentials->message()],
            ]);
        }

        $tokens = $issuer->issue($user, $request, $request->validated('device_name'));

        return ApiResponse::success(new SessionResource($tokens))
            ->withCookie(RefreshCookie::issue($tokens->refreshToken, $tokens->refreshExpiresAt));
    }
}
