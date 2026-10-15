import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { db } from '../db/piston-db';
import { todayIso } from '../format';
import { UnitsService } from '../units.service';
import type { DocumentType, IsoDate, Reminder, Uuid, Vehicle, VehicleDocument } from '../models';
import { DOCUMENT_LABEL, documentStatus, expiryLabel, isCurrent } from './document-status';
import { OfflineStore } from './offline-store.service';
import { dueLabel, reminderState, type DistanceFormat } from './reminder-schedule';

/** `warn`: está por vencer. `bad`: ya venció o se pasó. */
export type AlertTone = 'warn' | 'bad';

/** De dónde sale: cada una se puede apagar aparte en Ajustes › Notificaciones. */
export type AlertCategory = 'insurance' | 'documents' | 'reminders';

/**
 * Algo del vehículo que pide atención: una póliza por vencer, un recordatorio
 * pasado. Se queda mientras no se resuelva, aunque ya se haya notificado.
 */
export interface VehicleAlert {
  readonly id: string;
  readonly vehicle_id: Uuid;
  readonly tone: AlertTone;
  readonly title: string;
  readonly detail: string;
  /** Vista donde se resuelve. */
  readonly route: string;
  readonly category: AlertCategory;
  /**
   * Identifica este aviso en concreto: la fila, el tono y el vencimiento. Si
   * pasa de warn a bad, o se mueve la fecha, es otro aviso y vuelve a notificar.
   */
  readonly key: string;
  /** La fila permite notificación del sistema (`notify_enabled`). El badge sale igual. */
  readonly notify: boolean;
}

/**
 * Origen único de las alertas de vehículos. Los badges y las notificaciones
 * solo leen de aquí; cada sección que agrega algo vencible (póliza,
 * documentos, recordatorios) suma su fuente a `alerts`.
 *
 * Ver `docs/vehicle-section.md`. Fuentes: documentos vigentes (póliza y los
 * demás) por vencer o vencidos, y recordatorios abiertos próximos o pasados.
 */
@Injectable({ providedIn: 'root' })
export class VehicleAlerts {
  private readonly store = inject(OfflineStore);
  private readonly units = inject(UnitsService);

  /**
   * El día cambia con la app abierta (o dormida en segundo plano): sin esto,
   * una póliza que vence a medianoche no avisaría hasta recargar.
   */
  private readonly today = signal(todayIso());

  private readonly documents = this.store.liveSignal(
    async () => (await db.documents.toArray()).filter(isCurrent),
    [] as VehicleDocument[],
  );

  private readonly reminders = this.store.liveSignal(
    async () => (await db.reminders.toArray()).filter(isOpen),
    [] as Reminder[],
  );

  /** Para los recordatorios por km: el odómetro de cada vehículo. */
  private readonly vehicles = this.store.liveSignal(() => db.vehicles.toArray(), [] as Vehicle[]);

  readonly alerts = computed<readonly VehicleAlert[]>(() => [
    ...documentAlerts(this.documents(), this.today()),
    ...reminderAlerts(this.reminders(), this.vehicles(), this.today(), (km) => this.units.formatDistance(km)),
  ]);

  constructor() {
    const refresh = () => this.today.set(todayIso());
    const timer = setInterval(refresh, 60 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
  }

  /**
   * Las de vehículos activos: un archivado o vendido no pide atención en el
   * garage. Es lo que cuentan la pestaña, el icono de la app y las
   * notificaciones.
   */
  readonly active = computed<readonly VehicleAlert[]>(() => {
    const active = new Set(
      this.vehicles()
        .filter((vehicle) => !vehicle.deleted_at && vehicle.status === 'active')
        .map((vehicle) => vehicle.id),
    );
    return this.alerts().filter((alert) => active.has(alert.vehicle_id));
  });

  /** Total de todos los vehículos activos, no solo el de gestión. */
  readonly count = computed(() => this.active().length);

  /** Las de un vehículo. Dentro de un `computed`, se reevalúa sola. */
  forVehicle(vehicleId: Uuid | null): readonly VehicleAlert[] {
    return vehicleId ? this.alerts().filter((alert) => alert.vehicle_id === vehicleId) : [];
  }
}

/** El tono del badge para un grupo: manda la más grave. */
export function worstTone(alerts: readonly VehicleAlert[]): AlertTone | null {
  if (alerts.some((alert) => alert.tone === 'bad')) return 'bad';
  return alerts.length ? 'warn' : null;
}

/** Vista donde se atiende cada tipo: la póliza tiene la suya, el resto va a Documentos. */
function documentRoute(type: DocumentType): string {
  return type === 'insurance' ? '/vehicle/insurance' : '/vehicle/documents';
}

/** Documentos vigentes que vencen en la ventana de aviso o ya vencieron. */
export function documentAlerts(documents: readonly VehicleDocument[], today: IsoDate): VehicleAlert[] {
  const alerts: VehicleAlert[] = [];
  for (const document of documents) {
    const status = documentStatus(document.expires_at, today);
    if (!isCurrent(document) || status === 'ok') continue;
    const tone: AlertTone = status === 'expired' ? 'bad' : 'warn';
    alerts.push({
      id: `document:${document.id}`,
      vehicle_id: document.vehicle_id,
      tone,
      title: document.type === 'insurance' ? 'Póliza de seguro' : (document.title ?? DOCUMENT_LABEL[document.type]),
      detail: expiryLabel(document.expires_at!, today),
      route: documentRoute(document.type),
      category: document.type === 'insurance' ? 'insurance' : 'documents',
      key: `document:${document.id}:${tone}:${document.expires_at}`,
      notify: document.notify_enabled !== false,
    });
  }
  return alerts;
}

/** Abierto = no borrado ni en la bitácora. Solo estos avisan. */
export function isOpen(reminder: Reminder): boolean {
  return !reminder.deleted_at && (reminder.status === 'pending' || reminder.status === 'notified');
}

/** Recordatorios abiertos que entraron en su ventana de aviso o ya se pasaron. */
export function reminderAlerts(
  reminders: readonly Reminder[],
  vehicles: readonly Vehicle[],
  today: IsoDate,
  distance?: DistanceFormat,
): VehicleAlert[] {
  const odometer = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.current_odometer_km]));
  const alerts: VehicleAlert[] = [];
  for (const reminder of reminders) {
    if (!isOpen(reminder)) continue;
    const km = odometer.get(reminder.vehicle_id) ?? null;
    const state = reminderState(reminder, today, km);
    if (state === 'ok') continue;
    const tone: AlertTone = state === 'overdue' ? 'bad' : 'warn';
    alerts.push({
      id: `reminder:${reminder.id}`,
      vehicle_id: reminder.vehicle_id,
      tone,
      title: reminder.title,
      detail: dueLabel(reminder, today, km, distance),
      route: '/vehicle/reminders',
      category: 'reminders',
      key: `reminder:${reminder.id}:${tone}:${reminder.due_date ?? ''}:${reminder.due_odometer_km ?? ''}`,
      notify: reminder.notify_enabled !== false,
    });
  }
  return alerts;
}
