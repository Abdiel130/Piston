<?php

namespace App\Http\Controllers;

use App\Exceptions\ApiException;
use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;
use App\Models\Domain\Attachment;
use App\Sync\SyncAccess;
use App\Sync\SyncRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * POST /api/attachments/{id}/file: el binario de un adjunto.
 *
 * La fila ya viajó por el sync; aquí solo llega el archivo. Es idempotente:
 * volver a subir el mismo adjunto reemplaza el archivo. Si la fila todavía no
 * llegó responde 404, que el cliente trata como "reintenta después".
 */
class AttachmentFileController extends Controller
{
    public function __invoke(Request $request, string $id, SyncAccess $access): ApiResponse
    {
        $table = SyncRegistry::find('attachments');
        $attachment = Str::isUuid($id) ? Attachment::query()->find($id) : null;

        if ($attachment === null || ! $access->owns($table, $attachment, $request->user())) {
            throw ApiException::of(ApiCode::NotFound, 'El servidor todavía no tiene ese adjunto.');
        }

        $maxKb = (int) config('piston.sync.attachment_max_kb');
        $file = $request->file('file');

        if ($file !== null && $file->getSize() > $maxKb * 1024) {
            throw ApiException::of(ApiCode::PayloadTooLarge, 'El archivo pesa más de '.intdiv($maxKb, 1024).' MB.');
        }

        $request->validate(['file' => ['required', 'file']]);

        $checksum = hash_file('sha256', $file->getRealPath());
        if ($attachment->checksum !== null && ! hash_equals(strtolower($attachment->checksum), $checksum)) {
            throw ApiException::of(
                ApiCode::ValidationFailed,
                'El archivo llegó dañado (checksum distinto).',
                ['file' => ['El checksum no coincide con el del registro.']],
            );
        }

        $path = $file->storeAs("attachments/{$attachment->user_id}", $attachment->getKey(), 'local');

        $attachment->forceFill([
            'storage_path' => $path,
            'upload_status' => 'uploaded',
            'mime_type' => $attachment->mime_type ?? $file->getMimeType(),
            'size_bytes' => $file->getSize(),
        ])->save();

        return ApiResponse::success($attachment->toArray());
    }
}
