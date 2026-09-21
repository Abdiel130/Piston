import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService, PermanentApiError } from '../api/api.service';
import { db } from '../db/piston-db';
import {
  GLOBAL_CURSOR,
  TABLE_ORDER,
  type DomainTable,
  type OutboxEntry,
  type SyncFields,
  type SyncPushMutation,
} from '../models';
import { MAX_ATTEMPTS, nextRetryAt } from './backoff';

/** Mutaciones por petición. Acotado para que un lote no reviente el servidor. */
const PUSH_BATCH_SIZE = 200;

/** Vueltas máximas del pull paginado, por si el servidor nunca baja `has_more`. */
const MAX_PULL_PAGES = 50;

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/**
 * El motor de sincronización.
 *
 * Empuja primero y jala después, siempre en ese orden: si se jalara primero,
 * el servidor mandaría la versión vieja de una fila que este dispositivo acaba
 * de cambiar y el last-write-wins la pisaría con datos anteriores.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(ApiService);

  private readonly _status = signal<SyncStatus>('idle');
  private readonly _lastError = signal<string | null>(null);
  private readonly _lastSyncedAt = signal<string | null>(null);
  private readonly _online = signal(navigator.onLine);

  readonly status = this._status.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly lastSyncedAt = this._lastSyncedAt.asReadonly();
  readonly online = this._online.asReadonly();

  /** Mutaciones esperando. Se reemite sola: es lo que ve la Dynamic Island. */
  readonly pendingCount = toSignal(
    from(liveQuery(() => db.sync_outbox.where('status').notEqual('failed').count())),
    { initialValue: 0 },
  );

  /** Mutaciones que agotaron los reintentos y necesitan que alguien mire. */
  readonly failedCount = toSignal(
    from(liveQuery(() => db.sync_outbox.where('status').equals('failed').count())),
    { initialValue: 0 },
  );

  /** Adjuntos cuyo binario aún no sube. */
  readonly pendingUploads = toSignal(
    from(liveQuery(() => db.attachments.where('upload_status').equals('pending').count())),
    { initialValue: 0 },
  );

  readonly hasPendingWork = computed(() => this.pendingCount() > 0 || this.pendingUploads() > 0);

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Arranca el ciclo automático. Se llama una vez, al iniciar la app. */
  start(): void {
    if (this.timer) {
      return;
    }

    globalThis.addEventListener('online', this.handleOnline);
    globalThis.addEventListener('offline', this.handleOffline);

    this.timer = setInterval(() => void this.sync(), environment.syncIntervalMs);
    void this.sync();
  }

  stop(): void {
    globalThis.removeEventListener('online', this.handleOnline);
    globalThis.removeEventListener('offline', this.handleOffline);

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Un ciclo completo. Seguro de llamar en cualquier momento: si ya hay uno en
   * curso, se ignora la llamada en vez de duplicar peticiones.
   */
  async sync(): Promise<void> {
    if (this.running) {
      return;
    }

    if (!navigator.onLine) {
      this._online.set(false);
      this._status.set('offline');
      return;
    }

    this.running = true;
    this._online.set(true);
    this._status.set('syncing');

    try {
      await this.push();
      await this.pull();
      await this.uploadAttachments();

      this._lastSyncedAt.set(new Date().toISOString());
      this._lastError.set(null);
      this._status.set('idle');
    } catch (error) {
      this._lastError.set(error instanceof Error ? error.message : String(error));
      this._status.set(navigator.onLine ? 'error' : 'offline');
    } finally {
      this.running = false;
    }
  }

  /** Devuelve una mutación fallida a la cola. Para un botón de "reintentar". */
  async retryFailed(): Promise<void> {
    const now = new Date().toISOString();
    await db.sync_outbox
      .where('status')
      .equals('failed')
      .modify({ status: 'pending', attempts: 0, next_retry_at: now });
    await this.sync();
  }

  // ── Push ────────────────────────────────────────────────────────────────

  private async push(): Promise<void> {
    const ready = await this.readyEntries();
    if (ready.length === 0) {
      return;
    }

    for (let i = 0; i < ready.length; i += PUSH_BATCH_SIZE) {
      const batch = ready.slice(i, i + PUSH_BATCH_SIZE);
      await this.pushBatch(batch);
    }
  }

  /**
   * Mutaciones cuyo momento de reintento ya pasó, ordenadas por dependencia.
   *
   * El orden de TABLE_ORDER importa aunque los ids los genere el cliente: el
   * servidor valida llaves foráneas, y un `fuel_entry` que llega antes que su
   * `vehicle` se rechaza con un error que parece un bug y no lo es.
   */
  private async readyEntries(): Promise<OutboxEntry[]> {
    const now = new Date().toISOString();
    const entries = await db.sync_outbox
      .where('status')
      .notEqual('failed')
      .filter((entry) => entry.next_retry_at <= now)
      .toArray();

    return entries.sort((a, b) => {
      const byTable = TABLE_ORDER.indexOf(a.table_name) - TABLE_ORDER.indexOf(b.table_name);
      return byTable !== 0 ? byTable : a.created_at.localeCompare(b.created_at);
    });
  }

  private async pushBatch(batch: readonly OutboxEntry[]): Promise<void> {
    const mutations: SyncPushMutation[] = batch.map((entry) => ({
      table: entry.table_name,
      id: entry.row_id,
      op: entry.op,
      payload: entry.payload ? (JSON.parse(entry.payload) as Record<string, unknown>) : null,
    }));

    try {
      const response = await this.api.push(mutations);

      // El `rev` que devuelve el servidor es el que evita que el siguiente pull
      // nos reenvíe nuestros propios cambios como si fueran novedades.
      // El lote puede tocar varias tablas, así que la transacción las abarca
      // todas: o se confirman juntas las filas y el vaciado del outbox, o nada.
      const tables = [db.sync_outbox, ...TABLE_ORDER.map((table) => db.table(table))];

      await db.transaction('rw', tables, async () => {
        for (const applied of response.applied) {
          await db.table(applied.table).update(applied.id, { rev: applied.rev });
        }
        await db.sync_outbox.bulkDelete(batch.map((entry) => entry.id));
      });

      for (const rejected of response.rejected) {
        await this.markFailed(batch, rejected.id, rejected.reason);
      }

      await this.bumpCursor(response.server_rev);
    } catch (error) {
      if (error instanceof PermanentApiError) {
        // Reintentar un 4xx solo repite el mismo rechazo. Se saca de la cola
        // activa para que una fila mal formada no bloquee todo lo que viene
        // detrás.
        await this.markBatchFailed(batch, error.message);
        return;
      }

      await this.scheduleRetry(batch, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async scheduleRetry(batch: readonly OutboxEntry[], reason: string): Promise<void> {
    await db.transaction('rw', db.sync_outbox, async () => {
      for (const entry of batch) {
        const attempts = entry.attempts + 1;
        await db.sync_outbox.update(entry.id, {
          attempts,
          last_error: reason,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          next_retry_at: nextRetryAt(attempts),
        });
      }
    });
  }

  private async markBatchFailed(batch: readonly OutboxEntry[], reason: string): Promise<void> {
    await db.transaction('rw', db.sync_outbox, async () => {
      for (const entry of batch) {
        await db.sync_outbox.update(entry.id, { status: 'failed', last_error: reason });
      }
    });
  }

  private async markFailed(
    batch: readonly OutboxEntry[],
    rowId: string,
    reason: string,
  ): Promise<void> {
    const entry = batch.find((candidate) => candidate.row_id === rowId);
    if (entry) {
      await db.sync_outbox.put({ ...entry, status: 'failed', last_error: reason });
    }
  }

  // ── Pull ────────────────────────────────────────────────────────────────

  private async pull(): Promise<void> {
    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      const since = await this.cursor();
      const response = await this.api.pull(since);

      for (const [table, rows] of Object.entries(response.changes)) {
        await this.applyRows(table as DomainTable, rows ?? []);
      }

      await this.bumpCursor(response.server_rev);

      if (!response.has_more) {
        return;
      }
    }
  }

  /**
   * Aplica lo que llegó del servidor, fila por fila.
   *
   * Dos reglas de resolución de conflicto, en este orden:
   *
   * 1. Si la fila tiene una mutación pendiente en el outbox, gana lo local. El
   *    push de la próxima vuelta la subirá; pisarla ahora perdería un cambio
   *    que el usuario ya dio por guardado.
   * 2. Si no, gana el `client_updated_at` más reciente (last-write-wins). Se
   *    compara el reloj del CLIENTE que hizo el cambio, no `updated_at` del
   *    servidor: lo que se quiere saber es quién editó después, no quién
   *    sincronizó después.
   */
  private async applyRows(table: DomainTable, rows: readonly SyncFields[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await db.transaction('rw', db.table(table), db.sync_outbox, async () => {
      for (const incoming of rows) {
        const dirty = await db.sync_outbox
          .where('[table_name+row_id]')
          .equals([table, incoming.id])
          .count();

        if (dirty > 0) {
          continue;
        }

        const local = (await db.table(table).get(incoming.id)) as SyncFields | undefined;

        if (local && local.client_updated_at > incoming.client_updated_at) {
          continue;
        }

        // Un tombstone se guarda igual que cualquier otra fila. No se borra de
        // IndexedDB: es la prueba de que el registro murió, y sin ella un
        // dispositivo desactualizado lo resucitaría en el siguiente push.
        await db.table(table).put(incoming);
      }
    });
  }

  // ── Adjuntos diferidos ──────────────────────────────────────────────────

  /**
   * Sube los binarios pendientes.
   *
   * Van por su propia cola y no por el outbox porque una foto de 4 MB no debe
   * bloquear la sincronización de los datos: la fila del adjunto ya viajó, y
   * la pantalla puede mostrar la imagen desde IndexedDB mientras tanto.
   */
  private async uploadAttachments(): Promise<void> {
    const pending = await db.attachments.where('upload_status').equals('pending').toArray();

    for (const attachment of pending) {
      if (!attachment.local_blob_key) {
        continue;
      }

      const stored = await db.attachment_blobs.get(attachment.local_blob_key);
      if (!stored) {
        await db.attachments.update(attachment.id, { upload_status: 'failed' });
        continue;
      }

      try {
        await db.attachments.update(attachment.id, { upload_status: 'uploading' });
        await this.api.uploadAttachment(attachment.id, stored.blob, attachment.file_name);
        await db.attachments.update(attachment.id, { upload_status: 'uploaded' });
      } catch (error) {
        await db.attachments.update(attachment.id, {
          upload_status: error instanceof PermanentApiError ? 'failed' : 'pending',
        });
        if (!(error instanceof PermanentApiError)) {
          throw error;
        }
      }
    }
  }

  // ── Cursor ──────────────────────────────────────────────────────────────

  private async cursor(): Promise<number> {
    const state = await db.sync_state.get(GLOBAL_CURSOR);
    return state?.last_rev ?? 0;
  }

  /** El cursor solo avanza. Retrocederlo reenviaría todo el histórico. */
  private async bumpCursor(rev: number): Promise<void> {
    const current = await this.cursor();
    if (rev <= current) {
      return;
    }

    await db.sync_state.put({
      table_name: GLOBAL_CURSOR,
      last_rev: rev,
      last_synced_at: new Date().toISOString(),
    });
  }

  private readonly handleOnline = (): void => {
    this._online.set(true);
    void this.sync();
  };

  private readonly handleOffline = (): void => {
    this._online.set(false);
    this._status.set('offline');
  };
}
