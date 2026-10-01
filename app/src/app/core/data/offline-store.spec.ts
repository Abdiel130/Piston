import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/piston-db';
import { isUuidV7 } from '../db/uuid';
import type { Vehicle } from '../models';
import { OfflineStore, type NewRow } from './offline-store.service';

function newVehicle(overrides: Partial<NewRow<Vehicle>> = {}): NewRow<Vehicle> {
  return {
    user_id: null,
    nickname: 'El Mazda',
    make: 'Mazda',
    model: '3 Sedan',
    year: 2022,
    trim: null,
    vehicle_type: 'car',
    transmission: 'automatic',
    engine_displacement_l: 2.5,
    color: null,
    vin: null,
    license_plate: null,
    plate_last_digit: null,
    emissions_sticker: 'none',
    default_fuel_grade: 'premium',
    tank_capacity_l: 51,
    gauge_total_segments: 8,
    factory_km_per_liter: null,
    oil_capacity_l: null,
    oil_spec: null,
    tire_pressure_front_psi: null,
    tire_pressure_rear_psi: null,
    current_odometer_km: 48_650,
    purchase_date: null,
    purchase_price: null,
    purchase_odometer_km: null,
    sale_date: null,
    sale_price: null,
    sale_odometer_km: null,
    status: 'active',
    is_primary: true,
    notes: null,
    ...overrides,
  };
}

describe('OfflineStore', () => {
  let store: OfflineStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(OfflineStore);

    await db.open();
    await Promise.all([db.vehicles.clear(), db.sync_outbox.clear()]);
  });

  it('crea la fila con UUIDv7 y rev 0', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());

    expect(isUuidV7(vehicle.id)).toBe(true);
    // rev 0 = el servidor todavía no conoce esta fila.
    expect(vehicle.rev).toBe(0);
    expect(vehicle.deleted_at).toBeNull();
    expect(await db.vehicles.get(vehicle.id)).toBeDefined();
  });

  it('encola la mutación en la misma transacción que la escritura', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    const queued = await db.sync_outbox.toArray();

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      table_name: 'vehicles',
      row_id: vehicle.id,
      op: 'insert',
      status: 'pending',
      attempts: 0,
    });
  });

  it('colapsa varias ediciones de la misma fila en un solo envío', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: 48_700 });
    await store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: 48_900 });

    const queued = await db.sync_outbox.toArray();
    expect(queued).toHaveLength(1);

    // Sigue siendo un insert: el servidor nunca vio esta fila.
    expect(queued[0].op).toBe('insert');

    const payload = JSON.parse(queued[0].payload!) as Vehicle;
    expect(payload.current_odometer_km).toBe(48_900);
  });

  it('anula el insert pendiente cuando la fila se borra antes de sincronizar', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await store.remove('vehicles', vehicle.id);

    // Pedirle al servidor que borre algo que nunca recibió es un 404 garantizado.
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('borra en suave y deja el tombstone en IndexedDB', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.clear(); // simula que ya se sincronizó

    await store.remove('vehicles', vehicle.id);

    const row = await db.vehicles.get(vehicle.id);
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBeNull();

    const queued = await db.sync_outbox.toArray();
    expect(queued[0]).toMatchObject({ op: 'delete' });
    expect(JSON.parse(queued[0].payload!).deleted_at).not.toBeNull();
  });

  it('un tombstone no aparece en las lecturas', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.clear();
    await store.remove('vehicles', vehicle.id);

    expect(await store.get('vehicles', vehicle.id)).toBeUndefined();
    expect(await store.list('vehicles')).toHaveLength(0);
  });

  it('avanza client_updated_at en cada edición', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await store.update<Vehicle>('vehicles', vehicle.id, { color: 'Rojo' });

    // Las entradas viejas (sin base_rev) aún suben con last-write-wins.
    expect(updated.client_updated_at > vehicle.client_updated_at).toBe(true);
  });

  it('guarda la base del primer cambio y la conserva al colapsar', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    expect((await db.sync_outbox.toArray())[0]).toMatchObject({ base_rev: 0, base: null });

    // Simula que ya subió y el servidor le dio rev 7.
    await db.sync_outbox.clear();
    await db.vehicles.update(vehicle.id, { rev: 7 });

    await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'uno' });
    await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'dos' });

    const [entry] = await db.sync_outbox.toArray();
    expect(entry.base_rev).toBe(7);
    // La base es lo que el usuario vio ANTES de empezar a editar.
    expect(JSON.parse(entry.base!).notes).toBeNull();
    expect(JSON.parse(entry.payload!).notes).toBe('dos');
  });

  it('un borrado después de editar conserva la misma base', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.clear();
    await db.vehicles.update(vehicle.id, { rev: 7 });

    await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'uno' });
    await store.remove('vehicles', vehicle.id);

    const [entry] = await db.sync_outbox.toArray();
    expect(entry).toMatchObject({ op: 'delete', base_rev: 7 });
    expect(JSON.parse(entry.base!).notes).toBeNull();
  });
});
