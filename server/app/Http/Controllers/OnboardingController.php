<?php

namespace App\Http\Controllers;

use App\Enums\OnboardingStep;
use App\Http\Requests\UpdateOnboardingRequest;
use App\Http\Resources\UserResource;
use App\Http\Responses\ApiResponse;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * Progreso del wizard de bienvenida.
 *
 * El cliente guarda primero en su base local y sube aquí cuando puede, así que
 * pueden llegar escrituras viejas (otro dispositivo, cola atrasada). Gana el
 * `updated_at` del cliente más reciente; una escritura más vieja se ignora y
 * se responde el estado vigente para que el cliente lo adopte.
 */
class OnboardingController extends Controller
{
    public function update(UpdateOnboardingRequest $request): ApiResponse
    {
        $user = $request->user();
        $incomingAt = CarbonImmutable::parse($request->validated('updated_at'));

        $alreadyDone = $user->onboarding_step === OnboardingStep::Done;
        $isStale = $user->onboarding_updated_at !== null
            && $incomingAt->lessThanOrEqualTo($user->onboarding_updated_at);

        if (! $alreadyDone && ! $isStale) {
            $user->forceFill([
                'onboarding_step' => $request->validated('step'),
                'onboarding_draft' => $request->validated('draft'),
                'onboarding_updated_at' => $incomingAt,
            ])->save();
        }

        return ApiResponse::success(new UserResource($user));
    }

    /** Terminar es definitivo: ninguna escritura posterior reabre el wizard. */
    public function complete(Request $request): ApiResponse
    {
        $user = $request->user();

        if ($user->onboarding_step !== OnboardingStep::Done) {
            $user->forceFill([
                'onboarding_step' => OnboardingStep::Done,
                'onboarding_draft' => null,
                'onboarding_updated_at' => now(),
                'onboarding_completed_at' => now(),
            ])->save();
        }

        return ApiResponse::success(new UserResource($user));
    }
}
