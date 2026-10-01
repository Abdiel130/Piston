/**
 * Pedidos al service worker (`public/piston-sw-sync.js`) para subir pendientes
 * con la app cerrada. Todo es "mejor esfuerzo": si el navegador no lo soporta,
 * o no hay worker (`ng serve`), no pasa nada y la app sincroniza al abrirse.
 */

import { environment } from '../../../environments/environment';

/** Mismo tag que escucha el worker. */
export const OUTBOX_TAG = 'piston-outbox';
export const DAILY_TAG = 'piston-daily';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface SyncCapableRegistration extends ServiceWorkerRegistration {
  readonly sync?: { register(tag: string): Promise<void> };
  readonly periodicSync?: { register(tag: string, options: { minInterval: number }): Promise<void> };
}

/**
 * URL con la que se registra el worker.
 *
 * El worker no ve `environment`: por defecto llama a la API en su propio
 * origen. Si la API vive en otro (`apiBaseUrl` no vacío), se le pasa en la
 * URL y la lee de `self.location`. Con la API en el mismo dominio la URL no
 * cambia, así que no se fuerza una reinstalación del worker.
 */
export function serviceWorkerUrl(apiBaseUrl: string = environment.apiBaseUrl): string {
  return apiBaseUrl ? `piston-sw.js?api=${encodeURIComponent(apiBaseUrl)}` : 'piston-sw.js';
}

async function registration(): Promise<SyncCapableRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // getRegistration y no `ready`: sin worker (desarrollo), `ready` nunca resuelve.
  const found = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  return (found as SyncCapableRegistration | undefined)?.active ? (found as SyncCapableRegistration) : null;
}

/**
 * Background Sync: el navegador despierta al worker en cuanto haya red, aunque
 * la app esté cerrada. Registrar el mismo tag dos veces no duplica nada.
 */
export async function requestOutboxSync(): Promise<void> {
  try {
    await (await registration())?.sync?.register(OUTBOX_TAG);
  } catch {
    // Sin permiso o sin soporte: la app sincroniza al abrirse.
  }
}

/**
 * Periodic Background Sync: ~una vez al día, cuando Chrome lo decida (no hay
 * forma de fijar una hora). Solo en la PWA instalada; en otros casos falla en
 * silencio.
 */
export async function requestDailySync(): Promise<void> {
  try {
    const reg = await registration();
    if (!reg?.periodicSync) return;
    const permission = await navigator.permissions
      .query({ name: 'periodic-background-sync' as PermissionName })
      .catch(() => null);
    if (permission && permission.state !== 'granted') return;
    await reg.periodicSync.register(DAILY_TAG, { minInterval: ONE_DAY_MS });
  } catch {
    // Sin soporte: no pasa nada.
  }
}
