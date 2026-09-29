import { db } from '../db/piston-db';

/**
 * Borra TODO lo local: dominio, outbox, cursor, adjuntos, sesión y wizard.
 *
 * Se vacían las tablas en vez de `db.delete()` para no cerrar la conexión
 * que otras partes de la app (liveQuery abiertos) siguen usando.
 */
export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

/** ¿Hay algo en el dispositivo que se perdería al cambiar de cuenta? */
export async function hasLocalData(): Promise<boolean> {
  const [vehicles, outbox] = await Promise.all([db.vehicles.count(), db.sync_outbox.count()]);
  return vehicles > 0 || outbox > 0;
}
