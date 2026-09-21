import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, PermanentApiError, RetriableApiError } from '../api/api.service';
import { OfflineStore, type NewRow } from '../data/offline-store.service';
import { db } from '../db/piston-db';
import { GLOBAL_CURSOR, type FuelEntry, type SyncPullResponse, type SyncPushResponse, type Vehicle } from '../models';
import { SyncService } from './sync.service';

/** Servidor de mentira: guarda lo que recibe y devuelve lo que se le indique. */
class FakeApi {
  pushed: unknown[][] = [];
  pushImpl: (m: unknown[]) => Promise<SyncPushResponse> = async (mutations) => ({
    applied: (mutations as { table: string; id: string }[]).map((m, i) => ({
      table: m.table as never,
      id: m.id,
      rev: 100 + i,
    })),
    rejected: [],
    server_rev: 100 + mutations.length,
  });
  pullImpl: (since: number) => Promise<SyncPullResponse> = async () => ({
    changes: {},
    server_rev: 0,
    has_more: false,
  });

  async push(mutations: unknown[]): Promise<SyncPushResponse> {
    this.pushed.push(mutations);
    return this.pushImpl(mutations);
  }

  async pull(since: number): Promise<SyncPullResponse> {
    return this.pullImpl(since);
  }

  async uploadAttachment(): Promise<void> {}
}

function newVehicle(): NewRow<Vehicle> {
  return {
    user_id: null, nickname: null, make: 'Mazda', model: '3', year: 2022, trim: null,
    vehicle_type: 'car', transmission: null, engine_displacement_l: null, color: null,
    vin: null, license_plate: null, plate_last_digit: null, emissions_sticker: 'none',
    default_fuel_grade: 'premium', tank_capacity_l: 51, gauge_total_segments: 8,
    factory_km_per_liter: null, oil_capacity_l: null, oil_spec: null,
    tire_pressure_front_psi: null, tire_pressure_rear_psi: null, current_odometer_km: 0,
    purchase_date: null, purchase_price: null, purchase_odometer_km: null,
    sale_date: null, sale_price: null, sale_odometer_km: null,
    status: 'active', is_primary: true, notes: null,
  };
}

describe('SyncService', () => {
  let sync: SyncService;
  let store: OfflineStore;
  let api: FakeApi;

  beforeEach(async () => {
    api = new FakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    sync = TestBed.inject(SyncService);
    store = TestBed.inject(OfflineStore);

    await db.open();
    await Promise.all([
      db.vehicles.clear(),
      db.fuel_entries.clear(),
      db.sync_outbox.clear(),
      db.sync_state.clear(),
    ]);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  it('vacía el outbox y graba el rev del servidor', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());

    await sync.sync();

    expect(await db.sync_outbox.count()).toBe(0);
    // Sin el rev del servidor, el siguiente pull nos devolvería nuestro propio
    // cambio como si fuera una novedad ajena.
    expect((await db.vehicles.get(vehicle.id))!.rev).toBe(100);
    expect((await db.sync_state.get(GLOBAL_CURSOR))!.last_rev).toBeGreaterThan(0);
  });

  it('empuja las tablas padre antes que las hijas', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await store.create<FuelEntry>('fuel_entries', {
      user_id: null, vehicle_id: vehicle.id, station_id: null,
      filled_at: new Date().toISOString(), odometer_km: 100, fuel_grade: 'premium',
      input_mode: 'by_amount', amount_paid: 600, price_per_liter: 24, liters: 25,
      gauge_before: 2, gauge_after: 6, gauge_total_segments: 8,
      is_full_tank: false, is_partial: true, missed_previous: false,
      liters_before_est: null, liters_after_est: null, distance_km: null,
      km_per_liter: null, cost_per_km: null, efficiency_method: 'none',
      is_efficiency_outlier: false, recomputed_at: null, notes: null,
    });

    await sync.sync();

    // Al revés, el servidor rechazaría la carga por llave foránea.
    const tables = (api.pushed[0] as { table: string }[]).map((m) => m.table);
    expect(tables.indexOf('vehicles')).toBeLessThan(tables.indexOf('fuel_entries'));
  });

  it('reintenta con backoff cuando la red falla, sin perder la mutación', async () => {
    await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => {
      throw new RetriableApiError('sin red', 0);
    };

    await sync.sync();

    const [entry] = await db.sync_outbox.toArray();
    expect(entry.status).toBe('pending');
    expect(entry.attempts).toBe(1);
    expect(entry.last_error).toBe('sin red');
    // La próxima vez no se intenta de inmediato: eso es el backoff.
    expect(entry.next_retry_at > new Date().toISOString()).toBe(true);
    expect(sync.status()).toBe('error');
  });

  it('marca como fallida la mutación que el servidor rechaza de forma definitiva', async () => {
    await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => {
      throw new PermanentApiError('año inválido', 422);
    };

    await sync.sync();

    const [entry] = await db.sync_outbox.toArray();
    // Se saca de la cola activa para que no bloquee lo que viene detrás.
    expect(entry.status).toBe('failed');
    expect(sync.failedCount).toBeDefined();
  });

  it('no reintenta antes de que venza el backoff', async () => {
    await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => {
      throw new RetriableApiError('sin red', 0);
    };
    await sync.sync();

    api.pushed = [];
    api.pushImpl = async () => ({ applied: [], rejected: [], server_rev: 1 });
    await sync.sync();

    expect(api.pushed).toHaveLength(0);
  });

  it('aplica los cambios que llegan del servidor', async () => {
    const remote = {
      id: '0192f000-0000-7000-8000-000000000001',
      make: 'Nissan', model: 'Versa', year: 2020,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      client_updated_at: '2026-09-01T00:00:00.000Z',
      deleted_at: null, rev: 42,
    };
    api.pullImpl = async () => ({ changes: { vehicles: [remote as never] }, server_rev: 42, has_more: false });

    await sync.sync();

    expect((await db.vehicles.get(remote.id))!.make).toBe('Nissan');
    expect((await db.sync_state.get(GLOBAL_CURSOR))!.last_rev).toBe(42);
  });

  it('el cambio local pendiente gana sobre lo que llega del servidor', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => {
      throw new RetriableApiError('sin red', 0);
    };
    api.pullImpl = async () => ({
      changes: {
        vehicles: [{ ...vehicle, make: 'Pisado por el servidor', rev: 7 } as never],
      },
      server_rev: 7,
      has_more: false,
    });

    await sync.sync().catch(() => undefined);

    // Pisarlo perdería un cambio que el usuario ya dio por guardado.
    expect((await db.vehicles.get(vehicle.id))!.make).toBe('Mazda');
  });

  it('un tombstone del servidor no revive al sincronizar', async () => {
    const remote = {
      id: '0192f000-0000-7000-8000-000000000002',
      make: 'Vendido', model: 'X', year: 2015,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
      client_updated_at: '2026-09-02T00:00:00.000Z',
      deleted_at: '2026-09-02T00:00:00.000Z',
      rev: 50,
    };
    api.pullImpl = async () => ({ changes: { vehicles: [remote as never] }, server_rev: 50, has_more: false });

    await sync.sync();

    // La fila SIGUE en IndexedDB: es la prueba del borrado. Lo que no debe es
    // aparecer en las lecturas.
    expect(await db.vehicles.get(remote.id)).toBeDefined();
    expect(await store.get('vehicles', remote.id)).toBeUndefined();
  });

  it('no pisa una edición local más reciente (last-write-wins)', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await sync.sync();               // vacía el outbox
    await store.update<Vehicle>('vehicles', vehicle.id, { make: 'Editado aquí' });
    await db.sync_outbox.clear();    // simula que ya se subió

    api.pullImpl = async () => ({
      changes: {
        vehicles: [{ ...vehicle, make: 'Viejo', client_updated_at: '2020-01-01T00:00:00.000Z', rev: 9 } as never],
      },
      server_rev: 9,
      has_more: false,
    });

    await sync.sync();

    expect((await db.vehicles.get(vehicle.id))!.make).toBe('Editado aquí');
  });

  it('el cursor solo avanza', async () => {
    await db.sync_state.put({ table_name: GLOBAL_CURSOR, last_rev: 500, last_synced_at: null });
    api.pullImpl = async () => ({ changes: {}, server_rev: 10, has_more: false });

    await sync.sync();

    // Retrocederlo obligaría a redescargar todo el histórico.
    expect((await db.sync_state.get(GLOBAL_CURSOR))!.last_rev).toBe(500);
  });

  it('sin conexión no intenta nada y lo dice', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await store.create<Vehicle>('vehicles', newVehicle());

    await sync.sync();

    expect(api.pushed).toHaveLength(0);
    expect(sync.status()).toBe('offline');
    expect(await db.sync_outbox.count()).toBe(1);
  });
});
