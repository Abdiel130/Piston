<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdatePasswordRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Resources\UserResource;
use App\Http\Responses\ApiResponse;
use App\Services\Auth\TokenIssuer;
use Illuminate\Http\Request;

class MeController extends Controller
{
    public function show(Request $request): ApiResponse
    {
        return ApiResponse::success(new UserResource($request->user()));
    }

    public function update(UpdateProfileRequest $request): ApiResponse
    {
        $user = $request->user();
        $user->update($request->validated());

        return ApiResponse::success(new UserResource($user), message: 'Perfil actualizado.');
    }

    /**
     * Cambia la contraseña y cierra las OTRAS sesiones. La actual sigue viva:
     * sacar al usuario del dispositivo donde acaba de cambiarla no tiene sentido.
     */
    public function password(UpdatePasswordRequest $request, TokenIssuer $issuer): ApiResponse
    {
        $user = $request->user();
        $user->forceFill(['password' => $request->validated('password')])->save();

        $issuer->revokeAll($user, exceptFamilyId: $issuer->familyOf($user));

        return ApiResponse::success(message: 'Contraseña actualizada. Se cerraron tus otras sesiones.');
    }
}
