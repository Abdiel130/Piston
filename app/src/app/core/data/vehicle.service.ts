import { Injectable, inject } from '@angular/core';
import { db } from '../db/piston-db';
import type { DomainTable, OdometerReading, Uuid, Vehicle } from '../models';
import { OfflineStore, type NewRow } from './offline-store.service';

/**
 * Lo que captura el formulario de vehículo. Lo derivado (terminación de placa,
 * odómetro cacheado, principal) lo administra este servicio.
 */
export type VehicleFields = Omit<
  NewRow<Vehicle>,
  'user_id' | 'plate_last_digit' | 'current_odometer_km' | 'is_primary'
>;

/** Cuánto historial cuelga de un vehículo. Decide si se puede borrar. */
export interface VehicleHistory {
  readonly fuel: number;
  readonly services: number;
  readonly expenses: number;
  /** Todo lo demás: documentos, viajes, fallas, planes, recordatorios. */
  readonly other: number;
}

/**
 * Bajar el odómetro choca con una carga o un servicio que registró más km.
 * No se corrige en silencio: el dato malo está en ese registro, no aquí.
 */
export class OdometerConflictError extends Error {
  override readonly name = 'OdometerConflictError';

  constructor(readonly count: number) {
    super(
      count === 1
        ? 'Hay una carga o un servicio con un odómetro mayor. Corrígelo primero.'
        : `Hay ${count} cargas o servicios con un odómetro mayor. Corrígelos primero.`,
    );
  }
}

/** Tablas con historial propio del vehículo, además del odómetro. */
const OTHER_HISTORY: readonly DomainTable[] = [
  'documents',
  'trips',
  'issues',
  'maintenance_schedules',
  'recurring_expenses',
  'reminders',
];

/**
 * Altas y cambios de vehículos.
 *
 * Reglas que viven aquí y no en la pantalla:
 * - `current_odometer_km` es caché de MAX(odometer_readings.km): cambiarlo
 *   siempre pasa por una lectura, nunca se escribe suelto.
 * - Hay como mucho UN principal, y si existe un vehículo activo, hay uno.
 */
@Injectable({ providedIn: 'root' })
export class VehicleService {
  private readonly store = inject(OfflineStore);

  async create(fields: VehicleFields, odometerKm: number, makePrimary: boolean): Promise<Vehicle> {
    return this.store.transaction(['vehicles', 'odometer_readings'], async () => {
      const others = await this.alive();
      const primary = makePrimary || !others.some((v) => v.status === 'active' && v.is_primary);

      const vehicle = await this.store.create<Vehicle>('vehicles', {
        ...normalize(fields),
        user_id: null,
        plate_last_digit: lastDigit(fields.license_plate),
        current_odometer_km: odometerKm,
        is_primary: primary && fields.status === 'active',
      });

      if (odometerKm > 0) {
        await this.addReading(vehicle.id, odometerKm);
      }
      if (vehicle.is_primary) {
        await this.demoteOthers(vehicle.id);
      }
      await this.ensurePrimary();
      return vehicle;
    });
  }

  /**
   * Guarda una corrección del registro. Si el odómetro cambió, lo ajusta por
   * medio de lecturas (ver `correctOdometer`).
   */
  async update(id: Uuid, fields: VehicleFields, odometerKm: number): Promise<Vehicle> {
    return this.store.transaction(['vehicles', 'odometer_readings'], async () => {
      const current = await this.require(id);
      const leavesActive = current.status === 'active' && fields.status !== 'active';

      await this.store.update<Vehicle>('vehicles', id, {
        ...normalize(fields),
        plate_last_digit: lastDigit(fields.license_plate),
        ...(leavesActive ? { is_primary: false } : {}),
      });

      if (odometerKm !== current.current_odometer_km) {
        await this.correctOdometer(current, odometerKm);
      }
      await this.ensurePrimary();
      return this.require(id);
    });
  }

  /** El vehículo que ven Garage, Combustible, Servicios y Gastos. */
  async setPrimary(id: Uuid): Promise<void> {
    await this.store.transaction(['vehicles'], async () => {
      const vehicle = await this.require(id);
      if (vehicle.status !== 'active') {
        throw new Error('Solo un vehículo activo puede ser el principal.');
      }
      if (!vehicle.is_primary) {
        await this.store.update<Vehicle>('vehicles', id, { is_primary: true });
      }
      await this.demoteOthers(id);
    });
  }

  async history(id: Uuid): Promise<VehicleHistory> {
    const count = async (table: DomainTable) => (await this.store.listBy(table, 'vehicle_id', id)).length;
    const [fuel, services, expenses, ...others] = await Promise.all([
      count('fuel_entries'),
      count('service_records'),
      count('expenses'),
      ...OTHER_HISTORY.map(count),
    ]);
    return { fuel, services, expenses, other: others.reduce((sum, n) => sum + n, 0) };
  }

  /**
   * Borra un vehículo capturado por error. Solo si no tiene historial: con
   * cargas o servicios lo correcto es archivarlo, no perder ese registro.
   */
  async remove(id: Uuid): Promise<void> {
    const history = await this.history(id);
    if (history.fuel + history.services + history.expenses + history.other > 0) {
      throw new Error('Este vehículo tiene historial. Archívalo en lugar de borrarlo.');
    }
    await this.store.transaction(['vehicles', 'odometer_readings', 'gauge_calibration_points'], async () => {
      for (const table of ['odometer_readings', 'gauge_calibration_points'] as const) {
        for (const row of await this.store.listBy(table, 'vehicle_id', id)) {
          await this.store.remove(table, row.id);
        }
      }
      await this.store.remove('vehicles', id);
      await this.ensurePrimary();
    });
  }

  /**
   * Ajusta el odómetro a `km`.
   *
   * Subir es una lectura nueva. Bajar es corregir un error de captura: se
   * borran las lecturas manuales por encima, pero si una carga o un servicio
   * registró más km, se rechaza —el error está en ese registro—. Una sola
   * regla cubre los dos casos: al subir, no hay lecturas por encima.
   */
  private async correctOdometer(vehicle: Vehicle, km: number): Promise<void> {
    // Las lecturas mandan, no la caché: puede ir atrás si algo la dejó vieja.
    const readings = await this.store.listBy<OdometerReading>('odometer_readings', 'vehicle_id', vehicle.id);
    const above = readings.filter((reading) => reading.km > km);
    const locked = above.filter((reading) => reading.source !== 'manual');
    if (locked.length > 0) {
      throw new OdometerConflictError(locked.length);
    }
    for (const reading of above) {
      await this.store.remove('odometer_readings', reading.id);
    }
    if (km > 0 && !readings.some((reading) => reading.km === km)) {
      await this.addReading(vehicle.id, km);
    }
    await this.store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: km });
  }

  private async addReading(vehicleId: Uuid, km: number): Promise<void> {
    await this.store.create<OdometerReading>('odometer_readings', {
      user_id: null,
      vehicle_id: vehicleId,
      read_at: new Date().toISOString(),
      km,
      source: 'manual',
      source_id: null,
      is_suspect: false,
    });
  }

  private async demoteOthers(id: Uuid): Promise<void> {
    for (const other of await this.alive()) {
      if (other.id !== id && other.is_primary) {
        await this.store.update<Vehicle>('vehicles', other.id, { is_primary: false });
      }
    }
  }

  /** Si quedan activos y ninguno es principal, el más antiguo lo es. */
  private async ensurePrimary(): Promise<void> {
    const active = (await this.alive()).filter((v) => v.status === 'active');
    if (active.length === 0 || active.some((v) => v.is_primary)) {
      return;
    }
    const oldest = active.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    await this.store.update<Vehicle>('vehicles', oldest.id, { is_primary: true });
  }

  private alive(): Promise<Vehicle[]> {
    return this.store.list<Vehicle>('vehicles');
  }

  private async require(id: Uuid): Promise<Vehicle> {
    const vehicle = await this.store.get<Vehicle>('vehicles', id);
    if (!vehicle) {
      throw new Error('El vehículo ya no existe.');
    }
    return vehicle;
  }
}

/** Textos recortados y vacíos como null; placa y VIN en mayúsculas. */
function normalize(fields: VehicleFields): VehicleFields {
  return {
    ...fields,
    make: fields.make.trim(),
    model: fields.model.trim(),
    nickname: blankToNull(fields.nickname),
    trim: blankToNull(fields.trim),
    color: blankToNull(fields.color),
    vin: blankToNull(fields.vin)?.toUpperCase() ?? null,
    license_plate: blankToNull(fields.license_plate)?.toUpperCase() ?? null,
    oil_spec: blankToNull(fields.oil_spec),
    notes: blankToNull(fields.notes),
  };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** La terminación de placa decide el calendario de verificación. */
export function lastDigit(plate: string | null | undefined): number | null {
  const digits = plate?.match(/\d/g);
  return digits ? Number(digits[digits.length - 1]) : null;
}
