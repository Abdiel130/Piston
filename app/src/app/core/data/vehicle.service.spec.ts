import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/piston-db';
import type { FuelEntry, OdometerReading, Vehicle } from '../models';
import { OfflineStore } from './offline-store.service';
import { OdometerConflictError, VehicleService, type VehicleFields } from './vehicle.service';

function fields(overrides: Partial<VehicleFields> = {}): VehicleFields {
  return {
    nickname: null,
    make: ' Mazda ',
    model: '3',
    year: 2022,
    trim: null,
    vehicle_type: 'car',
    transmission: null,
    engine_displacement_l: null,
    color: null,
    vin: null,
    license_plate: 'abc-123-d',
    emissions_sticker: 'none',
    default_fuel_grade: 'regular',
    tank_capacity_l: 51,
    gauge_total_segments: 8,
    factory_km_per_liter: null,
    oil_capacity_l: null,
    oil_spec: null,
    tire_pressure_front_psi: null,
    tire_pressure_rear_psi: null,
    purchase_date: null,
    purchase_price: null,
    purchase_odometer_km: null,
    sale_date: null,
    sale_price: null,
    sale_odometer_km: null,
    status: 'active',
    notes: null,
    ...overrides,
  };
}

async function readings(vehicleId: string): Promise<number[]> {
  const rows = await db.odometer_readings.where('vehicle_id').equals(vehicleId).toArray();
  return rows.filter((row) => !row.deleted_at).map((row) => row.km).sort((a, b) => a - b);
}

describe('VehicleService', () => {
  let service: VehicleService;
  let store: OfflineStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VehicleService);
    store = TestBed.inject(OfflineStore);
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('el primero es el principal y normaliza lo capturado', async () => {
    const vehicle = await service.create(fields(), 48_250, false);

    expect(vehicle.is_primary).toBe(true);
    expect(vehicle.make).toBe('Mazda');
    expect(vehicle.license_plate).toBe('ABC-123-D');
    expect(vehicle.plate_last_digit).toBe(3);
    expect(await readings(vehicle.id)).toEqual([48_250]);
  });

  it('hay un solo principal', async () => {
    const first = await service.create(fields(), 0, false);
    const second = await service.create(fields({ model: 'CX-5' }), 0, false);
    expect((await db.vehicles.get(second.id))?.is_primary).toBe(false);

    await service.setPrimary(second.id);
    expect((await db.vehicles.get(first.id))?.is_primary).toBe(false);
    expect((await db.vehicles.get(second.id))?.is_primary).toBe(true);
  });

  it('archivar el principal pasa el puesto a otro activo', async () => {
    const first = await service.create(fields(), 0, false);
    const second = await service.create(fields({ model: 'CX-5' }), 0, false);

    await service.update(first.id, fields({ status: 'archived' }), 0);

    expect((await db.vehicles.get(first.id))?.is_primary).toBe(false);
    expect((await db.vehicles.get(second.id))?.is_primary).toBe(true);
  });

  it('subir el odómetro agrega una lectura; bajarlo corrige las manuales', async () => {
    const vehicle = await service.create(fields(), 482_500, false);

    await service.update(vehicle.id, fields(), 48_250);
    expect(await readings(vehicle.id)).toEqual([48_250]);
    expect((await db.vehicles.get(vehicle.id))?.current_odometer_km).toBe(48_250);

    await service.update(vehicle.id, fields(), 49_000);
    expect(await readings(vehicle.id)).toEqual([48_250, 49_000]);
  });

  it('no baja el odómetro por debajo de una carga', async () => {
    const vehicle = await service.create(fields(), 1_000, false);
    await store.create<OdometerReading>('odometer_readings', {
      user_id: null,
      vehicle_id: vehicle.id,
      read_at: new Date().toISOString(),
      km: 2_000,
      source: 'fuel',
      source_id: null,
      is_suspect: false,
    });

    await expect(service.update(vehicle.id, fields(), 1_500)).rejects.toBeInstanceOf(OdometerConflictError);
  });

  it('solo borra vehículos sin historial', async () => {
    const empty = await service.create(fields(), 100, false);
    const used = await service.create(fields({ model: 'CX-5' }), 0, false);
    await store.create<FuelEntry>('fuel_entries', { vehicle_id: used.id } as unknown as FuelEntry);

    await expect(service.remove(used.id)).rejects.toThrow(/historial/);

    await service.remove(empty.id);
    expect(await store.get<Vehicle>('vehicles', empty.id)).toBeUndefined();
    expect(await readings(empty.id)).toEqual([]);
    // El que queda hereda el principal.
    expect((await db.vehicles.get(used.id))?.is_primary).toBe(true);
  });
});
