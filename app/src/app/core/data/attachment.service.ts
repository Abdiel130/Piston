import { Injectable, inject } from '@angular/core';
import { db } from '../db/piston-db';
import { uuidV7 } from '../db/uuid';
import type { Attachment, AttachmentKind, AttachmentOwner, Uuid } from '../models';
import { OfflineStore } from './offline-store.service';

/**
 * Adjuntos con subida diferida.
 *
 * El binario se guarda en IndexedDB y la fila se encola como cualquier otra
 * mutación. La foto se ve al instante aunque no haya red; el archivo sube
 * cuando la haya. Lo contrario —esperar a la subida para mostrar la imagen—
 * convierte "tomé la foto del ticket" en "perdí la foto del ticket".
 */
@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly store = inject(OfflineStore);

  async attach(
    ownerType: AttachmentOwner,
    ownerId: Uuid,
    file: File,
    kind: AttachmentKind = 'photo',
  ): Promise<Attachment> {
    const blobKey = uuidV7();

    const attachment = await this.store.create<Attachment>('attachments', {
      user_id: null,
      owner_type: ownerType,
      owner_id: ownerId,
      kind,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      width: null,
      height: null,
      checksum: await sha256(file),
      storage_path: null,
      local_blob_key: blobKey,
      upload_status: 'pending',
      sort_order: 0,
    });

    await db.attachment_blobs.add({
      key: blobKey,
      attachment_id: attachment.id,
      blob: file,
      created_at: new Date().toISOString(),
    });

    return attachment;
  }

  /** URL local para pintar el adjunto sin pasar por la red. */
  async localUrl(attachment: Attachment): Promise<string | null> {
    if (!attachment.local_blob_key) {
      return null;
    }

    const stored = await db.attachment_blobs.get(attachment.local_blob_key);
    return stored ? URL.createObjectURL(stored.blob) : null;
  }

  async listFor(ownerType: AttachmentOwner, ownerId: Uuid): Promise<Attachment[]> {
    const rows = await db.attachments
      .where('[owner_type+owner_id]')
      .equals([ownerType, ownerId])
      .toArray();
    return rows.filter((row) => !row.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  }

  async remove(attachment: Attachment): Promise<void> {
    await this.store.remove('attachments', attachment.id);
    if (attachment.local_blob_key) {
      await db.attachment_blobs.delete(attachment.local_blob_key);
    }
  }
}

/** SHA-256 en hex: deduplica y delata subidas a medias. */
async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
