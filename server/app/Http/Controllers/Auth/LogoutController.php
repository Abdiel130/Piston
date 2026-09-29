<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Cookies\RefreshCookie;
use App\Http\Responses\ApiResponse;
use App\Services\Auth\TokenIssuer;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class LogoutController extends Controller
{
    public function __invoke(Request $request, TokenIssuer $issuer): ApiResponse
    {
        $user = $request->user();
        $cookie = RefreshCookie::read($request);

        $families = array_filter([
            $issuer->familyOf($user),
            // La cookie puede pertenecer a otra familia si el access token es
            // de una sesión anterior; se cierran las dos.
            $cookie !== null ? $issuer->familyOfRefresh($cookie) : null,
        ]);

        foreach (array_unique($families) as $familyId) {
            $issuer->revokeFamily($familyId);
        }

        $token = $user->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        return ApiResponse::success(message: 'Sesión cerrada.')->withCookie(RefreshCookie::forget());
    }
}
