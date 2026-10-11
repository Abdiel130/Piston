import { Injectable, inject } from '@angular/core';
import { ApiError, ApiService, PermanentApiError } from '../api/api.service';
import { db } from '../db/piston-db';
import { uuidV7 } from '../db/uuid';
import type { Attachment, AttachmentOwner } from '../models';

/**
 * Dueños cuyos archivos se bajan en cada sync aunque nadie los abra. Una
 * póliza se necesita justo cuando no hay señal (un choque en carretera), así
 * que tiene que estar en el teléfono antes. Los tickets de carga, en cambio,
 * se bajan solo al abrirlos: bajarlos todos llenaría el dispositivo.
 */
const EAGER_OWNERS: readonly AttachmentOwner[] = ['document'];

/**
 * La otra mitad de los adjuntos: traer al dispositivo los archivos que subió
 * otro. El blob se guarda en `attachment_blobs` igual que uno propio, así que
 * se ve sin conexión con `AttachmentService.localUrl`.
 *
 * `local_blob_key` es solo del cliente: se escribe directo en Dexie, sin
 * outbox, y el pull lo conserva (`mergeAttachment`).
 */
@Injectable({ providedIn: 'root' })
export class AttachmentDownloads {
  private readonly api = inject(ApiService);
  private readonly inFlight = new Map<string, Promise<boolean>>();

  /** Subidos por otro dispositivo, vivos y sin copia aquí. */
  static missing(attachment: Attachment): boolean {
    return !attachment.deleted_at && !attachment.local_blob_key && attachment.upload_status === 'uploaded';
  }

  /**
   * Baja los de `EAGER_OWNERS` que falten. Un error de red corta la ronda
   * (se lanza, como el resto del ciclo); un 404 u otro rechazo solo salta ese
   * archivo y se reintenta en el siguiente ciclo. Devuelve cuántos bajó.
   */
  async fetchEager(): Promise<number> {
    const history = await historyDocumentIds();
    const missing = await db.attachments
      .where('upload_status')
      .equals('uploaded')
      .filter(
        (attachment) =>
          EAGER_OWNERS.includes(attachment.owner_type) &&
          AttachmentDownloads.missing(attachment) &&
          !(attachment.owner_type === 'document' && history.has(attachment.owner_id)),
      )
      .toArray();

    let fetched = 0;
    for (const attachment of missing) {
      try {
        if (await this.fetch(attachment)) fetched += 1;
      } catch (error) {
        if (!skippable(error)) throw error;
      }
    }
    return fetched;
  }

  /**
   * Baja uno y lo guarda. Dos llamadas al mismo tiempo (la vista y el sync)
   * comparten la descarga. `false` si ya no hace falta.
   */
  fetch(attachment: Attachment): Promise<boolean> {
    const running = this.inFlight.get(attachment.id);
    if (running) return running;
    const work = this.download(attachment).finally(() => this.inFlight.delete(attachment.id));
    this.inFlight.set(attachment.id, work);
    return work;
  }

  /**
   * El binario para verlo una vez: el local si está, si no del servidor SIN
   * guardarlo. Para el historial, que ya no ocupa espacio en el dispositivo.
   */
  async blob(attachment: Attachment): Promise<Blob> {
    const stored = attachment.local_blob_key ? await db.attachment_blobs.get(attachment.local_blob_key) : undefined;
    return stored?.blob ?? this.api.downloadAttachment(attachment.id);
  }

  /**
   * Libera del dispositivo los archivos de documentos que ya pasaron al
   * historial (renovados). Solo los que ya subieron: antes de eso el blob
   * local es la única copia. Después se ven con `blob()`, desde el servidor.
   */
  async evictHistory(): Promise<number> {
    const history = await historyDocumentIds();
    if (!history.size) return 0;
    const evictable = await db.attachments
      .filter(
        (attachment) =>
          attachment.owner_type === 'document' &&
          history.has(attachment.owner_id) &&
          !!attachment.local_blob_key &&
          attachment.upload_status === 'uploaded',
      )
      .toArray();
    if (!evictable.length) return 0;
    await db.transaction('rw', db.attachments, db.attachment_blobs, async () => {
      for (const attachment of evictable) {
        await db.attachment_blobs.delete(attachment.local_blob_key!);
        await db.attachments.update(attachment.id, { local_blob_key: null });
      }
    });
    return evictable.length;
  }

  /**
   * Libera los blobs de adjuntos que se borraron en otro dispositivo: el
   * tombstone llega por el pull, pero el archivo seguiría ocupando espacio.
   */
  async purgeDeleted(): Promise<void> {
    const orphans = await db.attachments
      .filter((attachment) => !!attachment.deleted_at && !!attachment.local_blob_key)
      .toArray();
    if (!orphans.length) return;
    await db.transaction('rw', db.attachments, db.attachment_blobs, async () => {
      for (const attachment of orphans) {
        await db.attachment_blobs.delete(attachment.local_blob_key!);
        await db.attachments.update(attachment.id, { local_blob_key: null });
      }
    });
  }

  private async download(attachment: Attachment): Promise<boolean> {
    const blob = await this.api.downloadAttachment(attachment.id);
    const key = uuidV7();
    return db.transaction('rw', db.attachments, db.attachment_blobs, async () => {
      // Pudo borrarse o bajarse por otra vía mientras llegaba el archivo.
      const current = await db.attachments.get(attachment.id);
      if (!current || !AttachmentDownloads.missing(current)) return false;
      await db.attachment_blobs.add({ key, attachment_id: attachment.id, blob, created_at: new Date().toISOString() });
      await db.attachments.update(attachment.id, { local_blob_key: key });
      return true;
    });
  }
}

/** El servidor aún no lo tiene (404) o lo rechaza: se salta solo ese archivo. */
function skippable(error: unknown): boolean {
  return error instanceof PermanentApiError || (error instanceof ApiError && error.status === 404);
}

/** Documentos que otro reemplazó: su lugar es el historial, no el dispositivo. */
async function historyDocumentIds(): Promise<Set<string>> {
  const renewed = await db.documents.filter((document) => !!document.renewed_by_id && !document.deleted_at).toArray();
  return new Set(renewed.map((document) => document.id));
}
