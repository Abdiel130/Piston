import type { IsoDateTime } from './domain';

/**
 * Qué notifica ESTE dispositivo. CLIENT-ONLY: el permiso del navegador ya es
 * por dispositivo, y así el teléfono puede avisar y la laptop no. Una sola
 * fila (key 'current'); sin fila, todo encendido.
 *
 * Lo comparte el service worker (`public/piston-sw-alerts.js`): si cambia la
 * forma, cambia allá también.
 */
export interface NotificationPrefs {
  readonly key: 'current';
  /** Interruptor general. Apagado, solo badges. */
  enabled: boolean;
  insurance: boolean;
  documents: boolean;
  reminders: boolean;
}

/**
 * Un aviso que ya se notificó en este dispositivo, por su `VehicleAlert.key`.
 * CLIENT-ONLY. Evita repetirlo entre aperturas y con el service worker.
 */
export interface NotifiedAlert {
  readonly key: string;
  readonly at: IsoDateTime;
}
