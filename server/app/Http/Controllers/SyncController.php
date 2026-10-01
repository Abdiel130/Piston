<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiException;
use App\Http\Requests\Sync\SyncPullRequest;
use App\Http\Requests\Sync\SyncPushRequest;
use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use App\Sync\SyncAccess;
use App\Sync\SyncPullService;
use App\Sync\SyncPushService;
use App\Sync\SyncRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Sync delta. Ver docs/api.md § Sincronización.
 */
class SyncController extends Controller
{
    /** GET /api/sync?since=<rev>&limit=<n> */
    public function pull(SyncPullRequest $request, SyncPullService $pull): ApiResponse
    {
        return ApiResponse::success($pull->pull($request->user(), $request->since(), $request->limit()));
    }

    /** POST /api/sync */
    public function push(SyncPushRequest $request, SyncPushService $push): ApiResponse
    {
        return ApiResponse::success($push->push($request->user(), $request->validated('mutations')));
    }

    /**
     * GET /api/sync/{table}/{id}: la versión del servidor de una fila.
     *
     * Para "descartar mi cambio": el cliente restaura lo que el servidor tiene.
     * Un tombstone también se devuelve; un 404 significa que nunca llegó.
     */
    public function show(Request $request, string $table, string $id, SyncAccess $access): ApiResponse
    {
        $definition = SyncRegistry::find($table) ?? throw ApiException::of(ApiCode::UnknownTable);
        $row = Str::isUuid($id) ? $definition->query()->find($id) : null;

        if ($row === null || ! $access->canRead($definition, $row, $request->user())) {
            throw ApiException::of(ApiCode::NotFound, 'El servidor no tiene ese registro.');
        }

        return ApiResponse::success(['table' => $table, 'row' => $row->toArray()]);
    }
}
