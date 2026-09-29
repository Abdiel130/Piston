import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService, AuthRequiredError, PermanentApiError } from '../api/api.service';
import { AuthService } from '../auth/auth.service';
import { db } from '../db/piston-db';
import { uuidV7 } from '../db/uuid';
import {
  GLOBAL_CURSOR,
  TABLE_ORDER,
  type Attachment,
  type DomainTable,
  type OutboxEntry,
  type RowRef,
  type SyncAttempt,
  type SyncFields,
  type SyncLogEntry,
  type SyncLogOutcome,
  type SyncPushMutation,
  type SyncPushResponse,
  type SyncRun,
  type SyncTrigger,
} from '../models';
import { requestDailySync, requestOutboxSync } from './background-sync';
import { nextRetryAt } from './backoff';
import { rowLabel } from './describe';
import { parentsOf, refKey } from './references';
import { classify, fromRejection } from './sync-failure';

/** Mutaciones por petición. Acotado para que un lote no reviente el servidor. */
const PUSH_BATCH_SIZE = 200;

/** Vueltas máximas del pull paginado, por si el servidor nunca baja `has_more`. */
const MAX_PULL_PAGES = 50;

/** Espera tras un cambio antes de sincronizar: agrupa ráfagas (p. ej. una carga + su odómetro). */
const CHANGE_DEBOUNCE_MS = 300;

/** Retención del historial local: lo que exceda cualquiera de los dos límites se purga. */
const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_EVENTS = 1000;

/**
 * Al volver a la app o recuperar la red sin nada por subir, solo se jala si el
 * último sync es más viejo que esto. Cambiar de app en Android dispara `focus`
 * a cada rato; no hace falta ir al servidor cada vez.
 */
const FRESHNESS_MS = 5 * 60 * 1000;

/** Web Lock compartido entre pestañas: solo una sincroniza a la vez. */
const SYNC_LOCK = 'piston-sync';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized';

/** Fase del ciclo en curso. Lo que muestra la ventana de sincronización. */
export interface SyncProgress {
  readonly phase: 'push' | 'pull' | 'uploads' | null;
  /** Filas recibidas en el pull del ciclo actual. */
  readonly pulled: number;
}

/** Por qué no se puede cerrar sesión todavía. `null` = se puede. */
export type LogoutBlocker =
  'offline' | 'syncing' | 'pending' | 'failed' | 'uploads' | 'expired' | null;

/** Estado de una sola palabra para la fila de Ajustes y el encabezado del centro de sync. */
export type SyncHealth = 'ok' | 'syncing' | 'pending' | 'error' | 'offline' | 'expired';

export interface SyncSummary {
  readonly health: SyncHealth;
  readonly pending: number;
  readonly failed: number;
  readonly blocked: number;
  readonly uploads: number;
  readonly failedUploads: number;
  readonly lastSyncedAt: string | null;
}

/**
 * El motor de sincronización.
 *
 * Empuja primero y jala después, siempre en ese orden: si se jalara primero,
 * el servidor mandaría la versión vieja de una fila que este dispositivo acaba
 * de cambiar y el last-write-wins la pisaría con datos anteriores.
 *
 * No hace polling a ciegas. Cuándo corre:
 *
 * - **Al abrir la app** y al iniciar sesión: ciclo completo (sube y jala).
 * - **Al haber un cambio**: ~300 ms después, reactivo.
 * - **Mientras queden pendientes**: un despertador en el `next_retry_at` más
 *   próximo (backoff de 5 s a 10 min). Ese es el "modo polling", y se apaga
 *   solo cuando la cola se vacía.
 * - **Al volver a la app o recuperar la red**: si hay pendientes, o si el
 *   último sync tiene más de 5 min.
 * - **Cada 10 min, de respaldo**: solo si hay algo por subir que ningún
 *   evento disparó. Sin pendientes no toca la red.
 * - **Con la app cerrada**: el service worker sube el outbox al volver la red
 *   (Background Sync) y ~una vez al día (Periodic Sync). Ver `background-sync.ts`.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly _status = signal<SyncStatus>('idle');
  private readonly _lastAttempt = signal<SyncAttempt | null>(null);
  private readonly _online = signal(navigator.onLine);
  private readonly _progress = signal<SyncProgress>({ phase: null, pulled: 0 });

  readonly status = this._status.asReadonly();
  /** Por qué falló el último ciclo (red, servidor…). `null` si terminó bien. */
  readonly lastAttempt = this._lastAttempt.asReadonly();
  readonly lastError = computed(() => this._lastAttempt()?.message ?? null);
  readonly online = this._online.asReadonly();
  readonly progress = this._progress.asReadonly();

  /** Último ciclo que terminó bien. De IndexedDB: todas las pestañas ven el mismo. */
  readonly lastSyncedAt = this.live(
    async () => (await db.sync_state.get(GLOBAL_CURSOR))?.last_synced_at ?? null,
    null,
  );

  /** Mutaciones esperando (o en vuelo). Se reemite sola: es lo que ve la Dynamic Island. */
  readonly pendingCount = this.live(
    () => db.sync_outbox.where('status').anyOf('pending', 'in_flight').count(),
    0,
  );

  /** Mutaciones que el servidor rechazó y necesitan que alguien mire. */
  readonly failedCount = this.live(() => db.sync_outbox.where('status').equals('failed').count(), 0);

  /** Mutaciones detenidas porque dependen de otra que no pudo subir. */
  readonly blockedCount = this.live(() => db.sync_outbox.where('status').equals('blocked').count(), 0);

  /**
   * Adjuntos cuyo binario está en ESTE dispositivo y aún no sube. Los que
   * llegaron de otro dispositivo no tienen blob local: no son de aquí.
   */
  readonly pendingUploads = this.live(
    () =>
      db.attachments
        .where('upload_status')
        .anyOf('pending', 'uploading')
        .filter((attachment) => !!attachment.local_blob_key)
        .count(),
    0,
  );

  readonly failedUploads = this.live(
    () =>
      db.attachments
        .where('upload_status')
        .equals('failed')
        .filter((attachment) => !!attachment.local_blob_key)
        .count(),
    0,
  );

  readonly hasPendingWork = computed(() => this.pendingCount() > 0 || this.pendingUploads() > 0);

  readonly summary = computed<SyncSummary>(() => {
    const pending = this.pendingCount();
    const failed = this.failedCount();
    const blocked = this.blockedCount();
    const uploads = this.pendingUploads();
    const failedUploads = this.failedUploads();

    let health: SyncHealth = 'ok';
    if (this.auth.state() === 'expired') health = 'expired';
    else if (!this._online()) health = 'offline';
    else if (this._status() === 'syncing') health = 'syncing';
    else if (failed + failedUploads > 0) health = 'error';
    else if (pending + blocked + uploads > 0) health = 'pending';

    return { health, pending, failed, blocked, uploads, failedUploads, lastSyncedAt: this.lastSyncedAt() };
  });

  /**
   * Cerrar sesión borra la base local, así que solo se permite cuando no queda
   * NADA que el servidor no tenga. Incluye las mutaciones fallidas: borrarlas
   * sería perder datos que el usuario dio por guardados.
   */
  readonly logoutBlocker = computed<LogoutBlocker>(() => {
    if (this.auth.state() === 'expired') return 'expired';
    if (!this._online()) return 'offline';
    if (this._status() === 'syncing') return 'syncing';
    if (this.failedCount() + this.blockedCount() + this.failedUploads() > 0) return 'failed';
    if (this.pendingCount() > 0) return 'pending';
    if (this.pendingUploads() > 0) return 'uploads';
    return null;
  });
  readonly canLogout = computed(() => this.logoutBlocker() === null);

  private started = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private wake: ReturnType<typeof setTimeout> | null = null;
  private queueWatch: { unsubscribe(): void } | null = null;
  private current: Promise<void> | null = null;
  private rerun = false;
  private lastSavedErrorKind: string | null = null;
  private outboxSyncRequested = false;

  constructor() {
    // Al recuperar la sesión (login, refresh tras expirar) lo pendiente sale ya.
    effect(() => {
      if (this.auth.state() === 'authenticated' && this.started) {
        untracked(() => this.request('login'));
      }
    });
  }

  /** Arranca el ciclo automático. Se llama una vez, al iniciar la app. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    globalThis.addEventListener('online', this.handleOnline);
    globalThis.addEventListener('offline', this.handleOffline);
    globalThis.addEventListener('focus', this.handleFocus);
    document.addEventListener('visibilitychange', this.handleVisibility);

    // El outbox es la señal principal: un cambio nuevo, o uno cuyo backoff
    // vence, dispara el sync. Viene de liveQuery, así que también reacciona a
    // lo que escriban otras pestañas.
    this.queueWatch = liveQuery(() => db.sync_outbox.where('status').equals('pending').toArray()).subscribe({
      next: (entries) => this.onQueueChanged(entries),
    });

    this.interval = setInterval(() => this.request('interval'), environment.syncSafetyIntervalMs);
    this.request('startup');
    void requestDailySync();
  }

  stop(): void {
    globalThis.removeEventListener('online', this.handleOnline);
    globalThis.removeEventListener('offline', this.handleOffline);
    globalThis.removeEventListener('focus', this.handleFocus);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.queueWatch?.unsubscribe();
    this.queueWatch = null;

    for (const timer of [this.debounce, this.wake]) {
      if (timer) clearTimeout(timer);
    }
    if (this.interval) clearInterval(this.interval);
    this.debounce = this.wake = this.interval = null;
    this.started = false;
  }

  /**
   * Un ciclo completo. Seguro de llamar en cualquier momento: si ya hay uno en
   * curso, se encadena otra vuelta al terminar y se espera a ambas. Así, quien
   * hace `await sync()` (el logout, la ventana tras el login) sabe que su
   * cambio ya se intentó.
   */
  async sync(trigger: SyncTrigger = 'manual'): Promise<void> {
    if (this.current) {
      this.rerun = true;
      return this.current;
    }

    this.current = this.loop(trigger).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  /**
   * El botón "Sincronizar": todo lo que no subió vuelve a la cola, sin esperar
   * el backoff, y corre un ciclo ya. Los rechazos definitivos se reintentan
   * también: el servidor pudo haberse corregido.
   */
  async retryAll(): Promise<void> {
    const now = new Date().toISOString();
    await db.transaction('rw', db.sync_outbox, db.attachments, async () => {
      await db.sync_outbox
        .where('status')
        .anyOf('failed', 'blocked')
        .modify({ status: 'pending', attempts: 0, next_retry_at: now, blocked_by: null });
      await db.sync_outbox.where('status').equals('pending').modify({ next_retry_at: now });
      await db.attachments
        .where('upload_status')
        .equals('failed')
        .filter((attachment) => !!attachment.local_blob_key)
        .modify({ upload_status: 'pending' });
    });
    await this.sync('manual');
  }

  async retryOne(entryId: string): Promise<void> {
    await db.sync_outbox.update(entryId, {
      status: 'pending',
      attempts: 0,
      next_retry_at: new Date().toISOString(),
      blocked_by: null,
    });
    await this.sync('manual');
  }

  /** Cambios que dependen de `entryId` (y de sus dependientes). Se descartarían con él. */
  async dependentsOf(entryId: string): Promise<OutboxEntry[]> {
    const all = await db.sync_outbox.toArray();
    const root = all.find((entry) => entry.id === entryId);
    if (!root) {
      return [];
    }

    const found = new Map<string, OutboxEntry>();
    const queue: RowRef[] = [{ table: root.table_name, id: root.row_id }];
    while (queue.length > 0) {
      const target = refKey(queue.shift()!);
      for (const entry of all) {
        if (entry.id === root.id || found.has(entry.id) || entry.op === 'delete') continue;
        if (parentsOf(entry.table_name, payloadOf(entry)).some((ref) => refKey(ref) === target)) {
          found.set(entry.id, entry);
          queue.push({ table: entry.table_name, id: entry.row_id });
        }
      }
    }
    return [...found.values()];
  }

  /**
   * Descarta un cambio que no subió (y los que dependen de él).
   *
   * Lo que el servidor nunca tuvo se borra del dispositivo. Lo que sí tiene se
   * restaura con su versión, así que eso requiere conexión: si no la hay, se
   * lanza el error y no se toca nada.
   */
  async discard(entryId: string): Promise<void> {
    const entry = await db.sync_outbox.get(entryId);
    if (!entry) {
      return;
    }

    const targets = [entry, ...(await this.dependentsOf(entryId))];
    const restore = new Map<string, SyncFields | null>();

    for (const target of targets) {
      const local = (await db.table(target.table_name).get(target.row_id)) as SyncFields | undefined;
      const serverKnowsIt = target.op !== 'insert' || (local?.rev ?? 0) > 0;
      restore.set(target.id, serverKnowsIt ? await this.api.row(target.table_name, target.row_id) : null);
    }

    const tables = [db.sync_outbox, db.sync_log, db.attachment_blobs, ...TABLE_ORDER.map((t) => db.table(t))];
    await db.transaction('rw', tables, async () => {
      for (const target of targets) {
        const server = restore.get(target.id) ?? null;
        const table = db.table(target.table_name);

        if (target.table_name === 'attachments' && !server) {
          const local = (await table.get(target.row_id)) as Attachment | undefined;
          if (local?.local_blob_key) await db.attachment_blobs.delete(local.local_blob_key);
        }

        if (server) {
          await table.put(server);
        } else {
          await table.delete(target.row_id);
        }
        await db.sync_outbox.delete(target.id);
        await db.sync_log.add(this.logEntry(null, target, 'discarded', null, null));
      }
    });
  }

  // ── Ciclo ───────────────────────────────────────────────────────────────

  private async loop(trigger: SyncTrigger): Promise<void> {
    if (!(await this.worthRunning(trigger))) {
      return;
    }

    let next = trigger;
    do {
      this.rerun = false;
      await this.withLock(() => this.cycle(next), next === 'manual' || next === 'login');
      next = 'change';
    } while (this.rerun);
  }

  /**
   * ¿Vale la pena ir al servidor? Lo que pide el usuario o un cambio nuevo
   * siempre corre; lo automático solo si hay algo por subir (o, al volver a la
   * app, si hace rato que no se jala).
   */
  private async worthRunning(trigger: SyncTrigger): Promise<boolean> {
    switch (trigger) {
      case 'interval':
        return this.hasLocalWork();
      case 'focus':
      case 'online': {
        const last = this.lastSyncedAt();
        return (await this.hasLocalWork()) || !last || Date.now() - Date.parse(last) > FRESHNESS_MS;
      }
      default:
        return true;
    }
  }

  /** Mutaciones en cola o archivos de este dispositivo sin subir. Los rechazados esperan al usuario. */
  private async hasLocalWork(): Promise<boolean> {
    const queued = await db.sync_outbox.where('status').anyOf('pending', 'in_flight').count();
    if (queued > 0) return true;
    const uploads = await db.attachments
      .where('upload_status')
      .equals('pending')
      .filter((attachment) => !!attachment.local_blob_key)
      .count();
    return uploads > 0;
  }

  /**
   * Una sola pestaña sincroniza a la vez. Las automáticas se saltan si otra
   * pestaña ya está en eso (verá los cambios por liveQuery); las manuales
   * esperan su turno para que el usuario vea el resultado de su botón.
   */
  private async withLock(run: () => Promise<void>, wait: boolean): Promise<void> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) {
      return run();
    }
    await locks.request(SYNC_LOCK, wait ? {} : { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  }

  private async cycle(trigger: SyncTrigger): Promise<void> {
    if (!navigator.onLine) {
      this._online.set(false);
      this._status.set('offline');
      return;
    }

    // Sin sesión viva no hay a quién mandarle nada. La cola se queda intacta
    // hasta el siguiente login.
    if (this.auth.state() !== 'authenticated') {
      this._status.set(this.auth.state() === 'expired' ? 'unauthorized' : 'idle');
      return;
    }

    this._online.set(true);
    this._status.set('syncing');
    this._progress.set({ phase: 'push', pulled: 0 });

    const run: SyncRun = {
      id: uuidV7(),
      started_at: new Date().toISOString(),
      finished_at: null,
      trigger,
      pushed: 0,
      applied: 0,
      stale: 0,
      rejected: 0,
      pulled: 0,
      uploaded: 0,
      outcome: 'running',
      error: null,
      request_ids: [],
    };

    try {
      // Tenemos el lock: lo que haya quedado `in_flight` es de un ciclo que
      // murió a medias (pestaña cerrada). Vuelve a la cola.
      await db.sync_outbox.where('status').equals('in_flight').modify({ status: 'pending' });

      await this.push(run);
      this._progress.update((progress) => ({ ...progress, phase: 'pull' }));
      await this.pull(run);
      this._progress.update((progress) => ({ ...progress, phase: 'uploads' }));
      await this.uploadAttachments(run);

      await this.markSynced();
      this._lastAttempt.set(null);
      this._status.set('idle');
      run.outcome = run.rejected > 0 ? 'partial' : 'ok';
    } catch (error) {
      const attempt = classify(error, navigator.onLine);
      run.error = attempt;
      run.outcome = attempt.kind === 'auth' ? 'auth' : 'failed';
      if (attempt.request_id && !run.request_ids.includes(attempt.request_id)) {
        run.request_ids.push(attempt.request_id);
      }

      this._lastAttempt.set(attempt);
      if (attempt.kind === 'offline') this._online.set(false);
      this._status.set(
        attempt.kind === 'auth' ? 'unauthorized' : attempt.kind === 'offline' ? 'offline' : 'error',
      );
    } finally {
      this._progress.update((progress) => ({ ...progress, phase: null }));
      run.finished_at = new Date().toISOString();
      await this.saveRun(run);
    }
  }

  // ── Push ────────────────────────────────────────────────────────────────

  private async push(run: SyncRun): Promise<void> {
    await this.releaseBlocked();
    const ready = await this.holdDependents(await this.readyEntries());

    for (let i = 0; i < ready.length; i += PUSH_BATCH_SIZE) {
      try {
        await this.pushBatch(ready.slice(i, i + PUSH_BATCH_SIZE), run);
      } catch (error) {
        // El servidor no está: lo que faltaba por enviar corre la misma suerte
        // que el lote que falló, en vez de dispararle un ciclo por lote.
        if (!(error instanceof AuthRequiredError)) {
          const rest = ready.slice(i + PUSH_BATCH_SIZE);
          if (rest.length > 0) await this.scheduleRetry(rest, classify(error, navigator.onLine));
        }
        throw error;
      }
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
    const now = Date.now();
    const entries = await db.sync_outbox
      .where('status')
      .equals('pending')
      .filter((entry) => Date.parse(entry.next_retry_at) <= now)
      .toArray();

    return entries.sort((a, b) => {
      const byTable = TABLE_ORDER.indexOf(a.table_name) - TABLE_ORDER.indexOf(b.table_name);
      return byTable !== 0 ? byTable : a.created_at.localeCompare(b.created_at);
    });
  }

  /**
   * No manda un hijo cuyo padre no puede subir. Si el padre está rechazado o
   * bloqueado, el hijo queda `blocked`; si el padre solo espera su backoff, el
   * hijo espera con él. Mandarlo igual solo produciría un `parent_missing`.
   */
  private async holdDependents(ready: OutboxEntry[]): Promise<OutboxEntry[]> {
    if (ready.length === 0) {
      return ready;
    }

    const all = await db.sync_outbox.toArray();
    const byRow = new Map(all.map((entry) => [refKey({ table: entry.table_name, id: entry.row_id }), entry]));
    const readyIds = new Set(ready.map((entry) => entry.id));
    const blockedNow = new Set<string>();
    const waitingNow = new Map<string, string>();
    const sendable: OutboxEntry[] = [];

    for (const entry of ready) {
      let blockedBy: RowRef | null = null;
      let waitUntil: string | null = null;

      // Borrar un hijo no necesita que el padre exista en el servidor.
      if (entry.op !== 'delete') {
        for (const parent of parentsOf(entry.table_name, payloadOf(entry))) {
          const parentEntry = byRow.get(refKey(parent));
          if (!parentEntry || parentEntry.id === entry.id) continue;

          if (parentEntry.status === 'failed' || parentEntry.status === 'blocked' || blockedNow.has(parentEntry.id)) {
            blockedBy = parent;
            break;
          }
          if (waitingNow.has(parentEntry.id)) {
            waitUntil = waitingNow.get(parentEntry.id)!;
          } else if (!readyIds.has(parentEntry.id)) {
            waitUntil = parentEntry.next_retry_at;
          }
        }
      }

      if (blockedBy) {
        blockedNow.add(entry.id);
        await db.sync_outbox.update(entry.id, {
          status: 'blocked',
          blocked_by: blockedBy,
          last_attempt: {
            at: new Date().toISOString(),
            kind: 'parent_missing',
            http_status: null,
            code: null,
            message: `Espera a que suba: ${rowLabel(blockedBy.table, payloadOf(byRow.get(refKey(blockedBy))!))}.`,
            request_id: null,
            field_errors: null,
            duration_ms: null,
            retry_after_s: null,
          },
        });
      } else if (waitUntil) {
        waitingNow.set(entry.id, waitUntil);
        await db.sync_outbox.update(entry.id, { next_retry_at: waitUntil });
      } else {
        sendable.push(entry);
      }
    }

    return sendable;
  }

  /** Suelta los `blocked` cuyo padre ya no está rechazado ni bloqueado. */
  private async releaseBlocked(): Promise<void> {
    const blocked = await db.sync_outbox.where('status').equals('blocked').toArray();
    if (blocked.length === 0) {
      return;
    }

    const stuck = new Set(
      (await db.sync_outbox.where('status').anyOf('failed', 'blocked').toArray()).map((entry) =>
        refKey({ table: entry.table_name, id: entry.row_id }),
      ),
    );
    const now = new Date().toISOString();

    for (const entry of blocked) {
      if (!entry.blocked_by || !stuck.has(refKey(entry.blocked_by))) {
        await db.sync_outbox.update(entry.id, { status: 'pending', blocked_by: null, next_retry_at: now });
      }
    }
  }

  private async pushBatch(batch: readonly OutboxEntry[], run: SyncRun): Promise<void> {
    await this.setStatus(batch, 'in_flight');

    const mutations: SyncPushMutation[] = batch.map((entry) => ({
      table: entry.table_name,
      id: entry.row_id,
      op: entry.op,
      payload: payloadOf(entry),
    }));

    let result;
    try {
      result = await this.api.push(mutations);
    } catch (error) {
      // Sesión caída: el lote es válido, solo falta quien lo firme. No cuenta
      // como intento, no se marca como fallido y se reintenta tras el login.
      if (error instanceof AuthRequiredError) {
        await this.setStatus(batch, 'pending');
        throw error;
      }

      if (error instanceof PermanentApiError) {
        // Un rechazo del lote entero (413, sobre inválido) no dice cuál fila
        // es la culpable. Se parte a la mitad hasta aislarla, en vez de dar
        // por fallidas 200 mutaciones por una sola.
        if (batch.length > 1) {
          const middle = Math.ceil(batch.length / 2);
          await this.pushBatch(batch.slice(0, middle), run);
          await this.pushBatch(batch.slice(middle), run);
          return;
        }
        const attempt = classify(error, true);
        await this.markFailed(batch[0], attempt);
        await db.sync_log.add(this.logEntry(run.id, batch[0], 'rejected', attempt.request_id, attempt));
        run.pushed += 1;
        run.rejected += 1;
        return;
      }

      await this.scheduleRetry(batch, classify(error, navigator.onLine));
      throw error;
    }

    await this.applyPushResult(batch, result.data, result.requestId, result.durationMs, run);
  }

  private async applyPushResult(
    batch: readonly OutboxEntry[],
    response: SyncPushResponse,
    requestId: string,
    durationMs: number,
    run: SyncRun,
  ): Promise<void> {
    run.pushed += batch.length;
    run.request_ids.push(requestId);

    const byRow = new Map(batch.map((entry) => [refKey({ table: entry.table_name, id: entry.row_id }), entry]));
    const answered = new Set<string>();
    const tables = [db.sync_outbox, db.sync_log, ...TABLE_ORDER.map((table) => db.table(table))];

    // El lote puede tocar varias tablas, así que la transacción las abarca
    // todas: o se confirman juntas las filas, el outbox y el historial, o nada.
    await db.transaction('rw', tables, async () => {
      for (const applied of response.applied) {
        const entry = byRow.get(refKey(applied));
        if (!entry) continue;
        answered.add(entry.id);

        // El `rev` que devuelve el servidor es el que evita que el siguiente
        // pull nos reenvíe nuestros propios cambios como si fueran novedades.
        if (applied.rev > 0 && !applied.stale) {
          await db.table(applied.table).update(applied.id, { rev: applied.rev });
        }
        // Si el usuario editó la fila mientras viajaba, `enqueue` ya reemplazó
        // esta entrada por otra nueva: este delete no la toca y la nueva sube
        // en la siguiente vuelta.
        await db.sync_outbox.delete(entry.id);
        await db.sync_log.add(this.logEntry(run.id, entry, applied.stale ? 'stale' : 'applied', requestId, null));
        if (applied.stale) run.stale += 1;
        else run.applied += 1;
      }

      for (const rejected of response.rejected) {
        const entry = byRow.get(refKey(rejected));
        if (!entry) continue;
        answered.add(entry.id);

        const attempt = fromRejection(rejected, requestId, durationMs);
        const blocker =
          rejected.code === 'parent_missing' ? await this.localBlocker(entry) : null;

        // `update` y no `put`: si la entrada ya no existe (la reemplazó una
        // edición nueva), no hay que resucitarla.
        await db.sync_outbox.update(entry.id, {
          status: blocker ? 'blocked' : 'failed',
          blocked_by: blocker,
          attempts: entry.attempts + 1,
          last_attempt: attempt,
        });
        await db.sync_log.add(this.logEntry(run.id, entry, 'rejected', requestId, attempt));
        run.rejected += 1;
      }
    });

    // Defensivo: lo que el servidor no mencionó vuelve a la cola tal cual.
    const unanswered = batch.filter((entry) => !answered.has(entry.id));
    if (unanswered.length > 0) await this.setStatus(unanswered, 'pending');
  }

  /**
   * El padre que falta, si este dispositivo lo tiene en cola. Con él, el hijo
   * queda `blocked` y sale solo cuando el padre suba; sin él (el padre no
   * está en ningún lado) es un rechazo que alguien tiene que ver.
   */
  private async localBlocker(entry: OutboxEntry): Promise<RowRef | null> {
    for (const parent of parentsOf(entry.table_name, payloadOf(entry))) {
      const queued = await db.sync_outbox.where('[table_name+row_id]').equals([parent.table, parent.id]).count();
      if (queued > 0) return parent;
    }
    return null;
  }

  private async setStatus(entries: readonly OutboxEntry[], status: OutboxEntry['status']): Promise<void> {
    await db.sync_outbox.bulkUpdate(entries.map((entry) => ({ key: entry.id, changes: { status } })));
  }

  private async scheduleRetry(entries: readonly OutboxEntry[], attempt: SyncAttempt): Promise<void> {
    const minDelayMs = (attempt.retry_after_s ?? 0) * 1000;
    await db.transaction('rw', db.sync_outbox, async () => {
      for (const entry of entries) {
        const attempts = entry.attempts + 1;
        await db.sync_outbox.update(entry.id, {
          attempts,
          status: 'pending',
          last_attempt: attempt,
          next_retry_at: nextRetryAt(attempts, new Date(), minDelayMs),
        });
      }
    });
  }

  private async markFailed(entry: OutboxEntry, attempt: SyncAttempt): Promise<void> {
    await db.sync_outbox.update(entry.id, {
      status: 'failed',
      attempts: entry.attempts + 1,
      last_attempt: attempt,
    });
  }

  // ── Pull ────────────────────────────────────────────────────────────────

  private async pull(run: SyncRun): Promise<void> {
    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      const since = await this.cursor();
      const { data: response, requestId } = await this.api.pull(since);
      if (page === 0) run.request_ids.push(requestId);

      for (const [table, rows] of Object.entries(response.changes)) {
        await this.applyRows(table as DomainTable, rows ?? []);
        run.pulled += rows?.length ?? 0;
        this._progress.update((progress) => ({
          ...progress,
          pulled: progress.pulled + (rows?.length ?? 0),
        }));
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
   * 1. Si la fila tiene una mutación en el outbox (pendiente, rechazada o
   *    bloqueada), gana lo local. El push la subirá o el usuario decidirá qué
   *    hacer con ella; pisarla ahora perdería un cambio que dio por guardado.
   * 2. Si no, gana el `client_updated_at` más reciente (last-write-wins). Se
   *    compara el reloj del CLIENTE que hizo el cambio, no `updated_at` del
   *    servidor: lo que se quiere saber es quién editó después, no quién
   *    sincronizó después. Se compara como fecha, no como texto.
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

        if (local && Date.parse(local.client_updated_at) > Date.parse(incoming.client_updated_at)) {
          continue;
        }

        // Un tombstone se guarda igual que cualquier otra fila. No se borra de
        // IndexedDB: es la prueba de que el registro murió, y sin ella un
        // dispositivo desactualizado lo resucitaría en el siguiente push.
        await db.table(table).put(table === 'attachments' ? mergeAttachment(local, incoming) : incoming);
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
  private async uploadAttachments(run: SyncRun): Promise<void> {
    const pending = await db.attachments.where('upload_status').equals('pending').toArray();

    for (const attachment of pending) {
      // Sin blob local, el adjunto lo subió otro dispositivo: no es de aquí.
      if (!attachment.local_blob_key) {
        continue;
      }

      const stored = await db.attachment_blobs.get(attachment.local_blob_key);
      if (!stored) {
        await db.attachments.update(attachment.id, { upload_status: 'failed' });
        await db.sync_log.add(
          this.uploadLog(run.id, attachment, 'upload_failed', {
            at: new Date().toISOString(),
            kind: 'client_bug',
            http_status: null,
            code: null,
            message: 'El archivo ya no está guardado en este dispositivo.',
            request_id: null,
            field_errors: null,
            duration_ms: null,
            retry_after_s: null,
          }),
        );
        continue;
      }

      try {
        await db.attachments.update(attachment.id, { upload_status: 'uploading' });
        const result = await this.api.uploadAttachment(attachment.id, stored.blob, attachment.file_name);
        await db.attachments.update(attachment.id, { upload_status: 'uploaded' });
        await db.attachment_blobs.update(stored.key, { last_attempt: null });
        await db.sync_log.add(this.uploadLog(run.id, attachment, 'uploaded', null, result.requestId));
        run.uploaded += 1;
        run.request_ids.push(result.requestId);
      } catch (error) {
        const attempt = classify(error, navigator.onLine);
        const permanent = error instanceof PermanentApiError;
        await db.attachments.update(attachment.id, { upload_status: permanent ? 'failed' : 'pending' });
        await db.attachment_blobs.update(stored.key, { last_attempt: attempt });
        if (!permanent) {
          throw error;
        }
        await db.sync_log.add(this.uploadLog(run.id, attachment, 'upload_failed', attempt));
      }
    }
  }

  // ── Cursor e historial ──────────────────────────────────────────────────

  private async cursor(): Promise<number> {
    const state = await db.sync_state.get(GLOBAL_CURSOR);
    return state?.last_rev ?? 0;
  }

  /**
   * El cursor solo avanza, y solo con el `server_rev` del PULL. El del push
   * no sirve: adelantarlo se saltaría cambios de otro dispositivo con un
   * `rev` menor que aún no se han jalado.
   */
  private async bumpCursor(rev: number): Promise<void> {
    const current = await db.sync_state.get(GLOBAL_CURSOR);
    if (rev <= (current?.last_rev ?? 0)) {
      return;
    }

    await db.sync_state.put({
      table_name: GLOBAL_CURSOR,
      last_rev: rev,
      last_synced_at: current?.last_synced_at ?? null,
    });
  }

  private async markSynced(): Promise<void> {
    const current = await db.sync_state.get(GLOBAL_CURSOR);
    await db.sync_state.put({
      table_name: GLOBAL_CURSOR,
      last_rev: current?.last_rev ?? 0,
      last_synced_at: new Date().toISOString(),
    });
  }

  /**
   * Guarda el ciclo en el historial si dice algo. Un ciclo del intervalo que
   * no movió nada no se guarda, y un mismo error repetido (servidor caído
   * durante una hora) solo se guarda la primera vez.
   */
  private async saveRun(run: SyncRun): Promise<void> {
    const didWork = run.pushed + run.pulled + run.uploaded > 0;
    const errorKind = run.error?.kind ?? null;

    if (!didWork && run.trigger !== 'manual') {
      if (!errorKind || errorKind === this.lastSavedErrorKind) return;
    }
    this.lastSavedErrorKind = errorKind;

    await db.sync_runs.put(run);
    await this.purgeHistory();
  }

  private async purgeHistory(): Promise<void> {
    const cutoff = new Date(Date.now() - HISTORY_MAX_AGE_MS).toISOString();
    await db.sync_log.where('at').below(cutoff).delete();
    await db.sync_runs.where('started_at').below(cutoff).delete();

    const extraLog = (await db.sync_log.count()) - HISTORY_MAX_EVENTS;
    if (extraLog > 0) {
      await db.sync_log.bulkDelete(await db.sync_log.orderBy('at').limit(extraLog).primaryKeys());
    }
    const extraRuns = (await db.sync_runs.count()) - HISTORY_MAX_EVENTS;
    if (extraRuns > 0) {
      await db.sync_runs.bulkDelete(await db.sync_runs.orderBy('started_at').limit(extraRuns).primaryKeys());
    }
  }

  private logEntry(
    runId: string | null,
    entry: OutboxEntry,
    outcome: SyncLogOutcome,
    requestId: string | null,
    attempt: SyncAttempt | null,
  ): SyncLogEntry {
    return {
      id: uuidV7(),
      run_id: runId,
      at: new Date().toISOString(),
      table_name: entry.table_name,
      row_id: entry.row_id,
      op: entry.op,
      label: rowLabel(entry.table_name, payloadOf(entry)),
      outcome,
      request_id: requestId,
      attempt,
    };
  }

  private uploadLog(
    runId: string,
    attachment: Attachment,
    outcome: SyncLogOutcome,
    attempt: SyncAttempt | null,
    requestId: string | null = attempt?.request_id ?? null,
  ): SyncLogEntry {
    return {
      id: uuidV7(),
      run_id: runId,
      at: new Date().toISOString(),
      table_name: 'attachments',
      row_id: attachment.id,
      op: 'upload',
      label: rowLabel('attachments', attachment as unknown as Record<string, unknown>),
      outcome,
      request_id: requestId,
      attempt,
    };
  }

  // ── Disparadores ────────────────────────────────────────────────────────

  /** Pide un ciclo. Las ráfagas se juntan en uno solo. */
  private request(trigger: SyncTrigger): void {
    if (this.debounce) {
      return;
    }
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.sync(trigger);
    }, CHANGE_DEBOUNCE_MS);
  }

  /** Sincroniza si algo ya venció y agenda un despertador para el próximo backoff. */
  private onQueueChanged(entries: readonly OutboxEntry[]): void {
    // Si la app se cierra con algo en cola, el worker lo sube al volver la red.
    // Se pide una vez por cada vez que la cola deja de estar vacía.
    if (entries.length > 0 && !this.outboxSyncRequested) {
      this.outboxSyncRequested = true;
      void requestOutboxSync();
    } else if (entries.length === 0) {
      this.outboxSyncRequested = false;
    }

    const now = Date.now();
    let nextWake = Number.POSITIVE_INFINITY;
    let due = false;

    for (const entry of entries) {
      const at = Date.parse(entry.next_retry_at);
      if (at <= now) due = true;
      else nextWake = Math.min(nextWake, at);
    }

    if (due) {
      this.request('change');
    }

    if (this.wake) clearTimeout(this.wake);
    this.wake = Number.isFinite(nextWake)
      ? setTimeout(() => this.request('change'), Math.min(nextWake - now + 50, 2 ** 31 - 1))
      : null;
  }

  private readonly handleOnline = (): void => {
    this._online.set(true);
    this.request('online');
  };

  private readonly handleOffline = (): void => {
    this._online.set(false);
    this._status.set('offline');
  };

  private readonly handleFocus = (): void => this.request('focus');

  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'visible') this.request('focus');
  };

  private live<T>(query: () => Promise<T>, initial: T) {
    return toSignal(from(liveQuery(query)), { initialValue: initial });
  }
}

function payloadOf(entry: OutboxEntry): Record<string, unknown> | null {
  return entry.payload ? (JSON.parse(entry.payload) as Record<string, unknown>) : null;
}

/**
 * La llave del blob y el estado de subida son de ESTE dispositivo: el
 * servidor no los conoce, así que lo que llega no debe borrarlos.
 */
function mergeAttachment(local: SyncFields | undefined, incoming: SyncFields): SyncFields {
  const mine = local as Attachment | undefined;
  const theirs = incoming as Attachment;
  if (!mine?.local_blob_key) {
    return incoming;
  }
  return {
    ...theirs,
    local_blob_key: mine.local_blob_key,
    upload_status: theirs.upload_status === 'uploaded' ? 'uploaded' : mine.upload_status,
  } as SyncFields;
}
