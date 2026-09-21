import { Injectable, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from, type Observable } from 'rxjs';
import { db } from '../db/piston-db';
import { uuidV7 } from '../db/uuid';
import type { DomainTable, SyncFields, Uuid } from '../models';

/** Campos que el repositorio administra y que quien llama no debe tocar. */
type ManagedFields = keyof SyncFields;

/** Lo que hay que pasar para crear una fila: todo menos lo que se gestiona solo. */
export type NewRow<T extends SyncFields> = Omit<T, ManagedFields> & { id?: Uuid };

/** Lo que se puede editar: cualquier campo propio, nunca los de sincronización. */
export type RowPatch<T extends SyncFields> = Partial<Omit<T, ManagedFields>>;

/**
 * Toda escritura del dominio pasa por aquí.
 *
 * La regla que justifica el servicio entero: **la fila y su entrada en el
 * outbox se escriben en la MISMA transacción de IndexedDB**. Si se hicieran en
 * dos pasos, un cierre de pestaña en medio dejaría un cambio guardado que
 * nadie va a enviar nunca —o peor, una mutación en cola apuntando a una fila
 * que no existe—. Es la diferencia entre "offline-first" y "offline y ya
 * veremos".
 *
 * Las lecturas excluyen tombstones por defecto. Un borrado no desaparece de
 * IndexedDB: se marca con `deleted_at` para poder propagarlo, y quien consulta
 * no debería tener que acordarse de eso en cada pantalla.
 */
@Injectable({ providedIn: 'root' })
export class OfflineStore {
  /**
   * Inserta una fila y encola su mutación.
   *
   * El id se genera aquí (UUIDv7) salvo que venga dado, lo cual solo tiene
   * sentido al restaurar un respaldo.
   */
  async create<T extends SyncFields>(table: DomainTable, data: NewRow<T>): Promise<T> {
    const now = new Date().toISOString();
    const row = {
      ...data,
      id: data.id ?? uuidV7(),
      created_at: now,
      updated_at: now,
      client_updated_at: now,
      deleted_at: null,
      // 0 = "el servidor todavía no conoce esta fila".
      rev: 0,
    } as unknown as T;

    await db.transaction('rw', db.table(table), db.sync_outbox, async () => {
      await db.table(table).add(row);
      await this.enqueue(table, row.id, 'insert', row);
    });

    return row;
  }

  /** Aplica un parche y encola la fila COMPLETA resultante. */
  async update<T extends SyncFields>(
    table: DomainTable,
    id: Uuid,
    patch: RowPatch<T>,
  ): Promise<T> {
    const now = new Date().toISOString();
    let updated!: T;

    await db.transaction('rw', db.table(table), db.sync_outbox, async () => {
      const current = (await db.table(table).get(id)) as T | undefined;
      if (!current) {
        throw new Error(`No existe ${table}/${id}`);
      }

      updated = { ...current, ...patch, updated_at: now, client_updated_at: now };
      await db.table(table).put(updated);
      await this.enqueue(table, id, 'update', updated);
    });

    return updated;
  }

  /**
   * Borrado lógico. La fila se queda como tombstone.
   *
   * Un borrado duro haría que el registro "reviva": otro dispositivo que aún no
   * se ha sincronizado volvería a subirlo tal cual, y al no existir aquí, el
   * pull lo reinsertaría. El tombstone es lo que convierte un borrado en un
   * hecho que se propaga.
   */
  async remove(table: DomainTable, id: Uuid): Promise<void> {
    const now = new Date().toISOString();

    await db.transaction('rw', db.table(table), db.sync_outbox, async () => {
      const current = (await db.table(table).get(id)) as SyncFields | undefined;
      if (!current || current.deleted_at) {
        return;
      }

      await db.table(table).put({ ...current, deleted_at: now, client_updated_at: now, updated_at: now });
      await this.enqueue(table, id, 'delete', null);
    });
  }

  /** Lee una fila viva. Un tombstone se comporta como "no existe". */
  async get<T extends SyncFields>(table: DomainTable, id: Uuid): Promise<T | undefined> {
    const row = (await db.table(table).get(id)) as T | undefined;
    return row && !row.deleted_at ? row : undefined;
  }

  /** Todas las filas vivas de una tabla. */
  async list<T extends SyncFields>(table: DomainTable): Promise<T[]> {
    const rows = (await db.table(table).toArray()) as T[];
    return rows.filter((row) => !row.deleted_at);
  }

  /** Filas vivas cuyo índice `key` vale `value`. */
  async listBy<T extends SyncFields>(
    table: DomainTable,
    key: string,
    value: unknown,
  ): Promise<T[]> {
    const rows = (await db.table(table).where(key).equals(value as never).toArray()) as T[];
    return rows.filter((row) => !row.deleted_at);
  }

  /**
   * Consulta reactiva: se reemite sola cuando cambia lo que toca, venga el
   * cambio de esta pestaña o del sync en segundo plano.
   */
  live$<R>(query: () => Promise<R>): Observable<R> {
    return from(liveQuery(query));
  }

  /** Igual que `live$`, pero como signal para consumir directo en plantillas. */
  liveSignal<R>(query: () => Promise<R>, initial: R): Signal<R> {
    return toSignal(this.live$(query), { initialValue: initial });
  }

  /**
   * Escribe la mutación en el outbox, colapsando lo que ya hubiera para la
   * misma fila.
   *
   * Editar cinco veces un registro sin conexión debe producir UN envío con el
   * estado final, no cinco. Y hay un caso que parece detalle y no lo es: si la
   * fila se creó offline (`insert` pendiente) y luego se borra, las dos
   * entradas se anulan entre sí —el servidor nunca supo de esa fila, así que
   * mandarle un DELETE es pedirle que borre algo que no tiene—.
   */
  private async enqueue(
    table: DomainTable,
    rowId: Uuid,
    op: 'insert' | 'update' | 'delete',
    row: SyncFields | null,
  ): Promise<void> {
    const pending = await db.sync_outbox
      .where('[table_name+row_id]')
      .equals([table, rowId])
      .toArray();

    const hadPendingInsert = pending.some((entry) => entry.op === 'insert');

    if (pending.length > 0) {
      await db.sync_outbox.bulkDelete(pending.map((entry) => entry.id));
    }

    if (op === 'delete' && hadPendingInsert) {
      return;
    }

    const now = new Date().toISOString();
    await db.sync_outbox.add({
      id: uuidV7(),
      table_name: table,
      row_id: rowId,
      // Una fila creada offline y editada después sigue siendo un insert para
      // el servidor: nunca la ha visto.
      op: hadPendingInsert && op === 'update' ? 'insert' : op,
      payload: row ? JSON.stringify(row) : null,
      status: 'pending',
      attempts: 0,
      last_error: null,
      next_retry_at: now,
      created_at: now,
    });
  }
}
