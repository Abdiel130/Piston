import { Injectable, computed } from '@angular/core';
import type { Uuid } from '../models';

/** `warn`: está por vencer. `bad`: ya venció o se pasó. */
export type AlertTone = 'warn' | 'bad';

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
}

/**
 * Origen único de las alertas de vehículos. Los badges y las notificaciones
 * solo leen de aquí; cada sección que agrega algo vencible (póliza,
 * documentos, recordatorios) suma su fuente a `alerts`.
 *
 * Ver `docs/vehicle-section.md`. Por ahora no hay fuentes.
 */
@Injectable({ providedIn: 'root' })
export class VehicleAlerts {
  readonly alerts = computed<readonly VehicleAlert[]>(() => []);

  readonly count = computed(() => this.alerts().length);

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
