/**
 * Se ejecuta ANTES de cualquier módulo de la app.
 *
 * Importa hace falta aquí y no en cada spec: Dexie captura la referencia a
 * `indexedDB` al construirse, y `db` es una instancia de módulo. Si el polyfill
 * llegara junto con los imports del spec, Dexie ya se habría construido contra
 * un jsdom que no tiene IndexedDB.
 */
import 'fake-indexeddb/auto';
