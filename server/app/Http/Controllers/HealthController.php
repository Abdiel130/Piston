<?php

namespace App\Http\Controllers;

use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Salud del servicio, para el CLI y los monitores del propio servidor.
 *
 * La ruta solo acepta loopback (LocalOnly), y aun así la respuesta no dice
 * nada que ayude a atacar si algún día se expone por error: ni versiones de
 * PHP o Laravel, ni driver, ni el texto del error de la base (que puede traer
 * host y usuario). Eso va al log, con el request_id que sí sale aquí.
 */
class HealthController extends Controller
{
    public function __invoke(): ApiResponse
    {
        $database = 'connected';

        try {
            DB::connection()->getPdo();
        } catch (Throwable $error) {
            $database = 'disconnected';
            Log::error('Health: la base de datos no responde.', ['exception' => $error]);
        }

        $data = [
            'status' => $database === 'connected' ? 'ok' : 'degraded',
            'service' => 'Piston API',
            'version' => config('piston.version'),
            'database' => $database,
        ];

        return $database === 'connected'
            ? ApiResponse::success($data)
            : ApiResponse::error(ApiCode::ServiceUnavailable)->withData($data);
    }
}
