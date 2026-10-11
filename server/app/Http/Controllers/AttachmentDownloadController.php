<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiException;
use App\Http\Responses\ApiCode;
use App\Models\Domain\Attachment;
use App\Sync\SyncAccess;
use App\Sync\SyncRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * GET /api/attachments/{id}/file: el binario de un adjunto, para el
 * dispositivo que no lo tiene.
 *
 * La fila llega por el pull; el archivo se baja aparte y el cliente lo guarda
 * en IndexedDB para verlo sin conexión. Mientras el dispositivo que lo creó
 * no lo suba, responde 404 y el cliente reintenta en otro ciclo.
 */
class AttachmentDownloadController extends Controller
{
    public function __invoke(Request $request, string $id, SyncAccess $access): StreamedResponse
    {
        $table = SyncRegistry::find('attachments');
        $attachment = Str::isUuid($id) ? Attachment::query()->find($id) : null;
        $disk = Storage::disk('local');

        if (
            $attachment === null
            || ! $access->owns($table, $attachment, $request->user())
            || $attachment->upload_status !== 'uploaded'
            || $attachment->storage_path === null
            || ! $disk->exists($attachment->storage_path)
        ) {
            throw ApiException::of(ApiCode::NotFound, 'El servidor todavía no tiene ese archivo.');
        }

        return $disk->response($attachment->storage_path, $attachment->file_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
