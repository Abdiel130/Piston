import { DestroyRef, type Signal, effect, inject, signal, untracked } from '@angular/core';
import { db } from '../../core/db/piston-db';
import type { Attachment } from '../../core/models';
import { AttachmentDownloads } from '../../core/sync/attachment-downloads.service';

interface Cached {
  readonly blobKey: string;
  readonly url: string;
}

/**
 * URLs locales de un conjunto de fotos, por id de adjunto. Para la galería,
 * que pinta muchas a la vez: cada URL se crea una sola vez por blob y se
 * revoca cuando la foto sale de la lista o se destruye la vista.
 *
 * Las fotos que subió otro dispositivo se bajan al mostrarlas (con red) y
 * quedan guardadas: la siguiente vez se ven sin conexión. Al guardarse, la
 * consulta en vivo de quien llama vuelve a emitir y aparece su URL.
 *
 * Debe llamarse en un contexto de inyección (constructor o campo).
 */
export function photoUrls(photos: Signal<readonly Attachment[]>): Signal<ReadonlyMap<string, string>> {
  const downloads = inject(AttachmentDownloads);
  const urls = signal<ReadonlyMap<string, string>>(new Map());
  const cache = new Map<string, Cached>();
  let loads = 0;
  let destroyed = false;

  const load = async (rows: readonly Attachment[]) => {
    const load = ++loads;
    const alive = new Set(rows.map((row) => row.id));
    for (const [id, cached] of cache) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!alive.has(id) || row?.local_blob_key !== cached.blobKey) {
        URL.revokeObjectURL(cached.url);
        cache.delete(id);
      }
    }

    const fresh = rows.filter((row) => row.local_blob_key && !cache.has(row.id));
    const blobs = await db.attachment_blobs.bulkGet(fresh.map((row) => row.local_blob_key!));
    if (destroyed) return;
    fresh.forEach((row, index) => {
      const stored = blobs[index];
      // Otra lectura más nueva pudo cachearla mientras esta esperaba.
      if (stored && !cache.has(row.id)) {
        cache.set(row.id, { blobKey: row.local_blob_key!, url: URL.createObjectURL(stored.blob) });
      }
    });
    if (load === loads) {
      urls.set(new Map([...cache].map(([id, cached]) => [id, cached.url])));
    }

    if (navigator.onLine) {
      for (const row of rows.filter(AttachmentDownloads.missing)) {
        downloads.fetch(row).catch(() => undefined);
      }
    }
  };

  effect(() => {
    const rows = photos();
    untracked(() => void load(rows));
  });

  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    cache.forEach((cached) => URL.revokeObjectURL(cached.url));
    cache.clear();
  });

  return urls.asReadonly();
}
