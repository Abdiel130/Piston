import type { AlertCategory, VehicleAlert } from '../data/vehicle-alerts.service';
import type { NotificationPrefs, Uuid } from '../models';

/**
 * Qué avisos suenan y con qué texto. Puro, para que la app y el service worker
 * (`public/piston-sw-alerts.js`, que lo replica en JS) decidan igual.
 */

/** Sin fila guardada, todo encendido: lo que falta es el permiso del navegador. */
export const DEFAULT_PREFS: NotificationPrefs = {
  key: 'current',
  enabled: true,
  insurance: true,
  documents: true,
  reminders: true,
};

/** Con más avisos nuevos que esto a la vez, sale uno solo que los resume. */
export const SUMMARY_AFTER = 3;

/** Tag de la notificación de resumen: una nueva reemplaza a la anterior. */
export const SUMMARY_TAG = 'piston-alerts';

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  insurance: 'Póliza de seguro',
  documents: 'Documentos',
  reminders: 'Recordatorios',
};

export interface NotificationMessage {
  readonly title: string;
  readonly body: string;
  /** Mismo tag = reemplaza a la anterior en lugar de apilarse. */
  readonly tag: string;
  /** A dónde lleva al tocarla, con el vehículo para cambiar a él. */
  readonly url: string;
}

/** El interruptor general, el de su tipo y el de la fila tienen que estar encendidos. */
export function allows(prefs: NotificationPrefs, alert: VehicleAlert): boolean {
  return prefs.enabled && prefs[alert.category] !== false && alert.notify;
}

/** Los que tocan sonar ahora: permitidos y que no hayan sonado ya en este dispositivo. */
export function dueNotifications(
  alerts: readonly VehicleAlert[],
  prefs: NotificationPrefs,
  notified: ReadonlySet<string>,
): VehicleAlert[] {
  return alerts.filter((alert) => allows(prefs, alert) && !notified.has(alert.key));
}

/** La vista del aviso, con el vehículo al que pertenece. */
export function alertUrl(alert: VehicleAlert): string {
  return `${alert.route}?vehicle=${encodeURIComponent(alert.vehicle_id)}`;
}

/**
 * Una notificación por aviso, o una sola si son muchos: al dar el permiso por
 * primera vez no deben caer diez de golpe. Con varios vehículos, el cuerpo
 * dice de cuál es.
 */
export function messagesFor(
  alerts: readonly VehicleAlert[],
  vehicleNames: ReadonlyMap<Uuid, string>,
): NotificationMessage[] {
  const several = new Set(alerts.map((alert) => alert.vehicle_id)).size > 1 || vehicleNames.size > 1;
  const body = (alert: VehicleAlert) => {
    const name = vehicleNames.get(alert.vehicle_id);
    return several && name ? `${name} · ${alert.detail}` : alert.detail;
  };

  if (alerts.length > SUMMARY_AFTER) {
    const shown = alerts.slice(0, SUMMARY_AFTER).map((alert) => `${alert.title}: ${body(alert)}`);
    const rest = alerts.length - SUMMARY_AFTER;
    return [
      {
        title: `${alerts.length} avisos de tus vehículos`,
        body: [...shown, `y ${rest} más`].join('\n'),
        tag: SUMMARY_TAG,
        url: '/',
      },
    ];
  }

  return alerts.map((alert) => ({
    // El detalle ya dice si vence o se pasó: "Venció hace 3 días".
    title: alert.title,
    body: body(alert),
    tag: alert.id,
    url: alertUrl(alert),
  }));
}
