import { Injectable, computed, inject } from '@angular/core';
import { db } from '../db/piston-db';
import type { Vehicle } from '../models';
import { OfflineStore } from './offline-store.service';

/**
 * El vehículo con el que trabajan las pantallas: el principal, o el primero
 * activo si ninguno está marcado. Se reemite solo al cambiar en IndexedDB,
 * venga el cambio de esta pestaña o del sync.
 */
@Injectable({ providedIn: 'root' })
export class VehicleContext {
  private readonly store = inject(OfflineStore);

  readonly vehicles = this.store.liveSignal(
    () => db.vehicles.filter((vehicle) => !vehicle.deleted_at).toArray(),
    [] as Vehicle[],
  );

  readonly vehicle = computed<Vehicle | null>(() => {
    const active = this.vehicles().filter((vehicle) => vehicle.status === 'active');
    return active.find((vehicle) => vehicle.is_primary) ?? active[0] ?? null;
  });

  readonly vehicleId = computed(() => this.vehicle()?.id ?? null);

  readonly displayName = computed(() => {
    const vehicle = this.vehicle();
    return vehicle ? (vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`) : 'Sin vehículo';
  });
}
