import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, AuthRequiredError, PermanentApiError, RetriableApiError, type ApiResult } from '../api/api.service';
import { AuthService, type AuthState } from '../auth/auth.service';
import { OfflineStore, type NewRow } from '../data/offline-store.service';
import { db } from '../db/piston-db';
import {
  GLOBAL_CURSOR,
  type FuelEntry,
  type SyncConflictDetail,
  type SyncFields,
  type SyncPullResponse,
  type SyncPushMutation,
  type SyncPushResponse,
  type Vehicle,
} from '../models';
import { SyncService } from './sync.service';

/** Servidor de mentira: guarda lo que recibe y devuelve lo que se le indique. */
class FakeApi {
  pushed: SyncPushMutation[][] = [];
  pushImpl: (m: SyncPushMutation[]) => Promise<SyncPushResponse> = async (mutations) => ({
    applied: mutations.map((m, i) => ({ table: m.table as never, id: m.id, rev: 100 + i })),
    rejected: [],
    server_rev: 100 + mutations.length,
  });
  pullImpl: (since: number) => Promise<SyncPullResponse> = async () => ({
    changes: {},
    server_rev: 0,
    has_more: false,
  });
  rows = new Map<string, unknown>();

  async push(mutations: FakeApi['pushed'][number]): Promise<ApiResult<SyncPushResponse>> {
    this.pushed.push(mutations);
    return { data: await this.pushImpl(mutations), requestId: 'req-push', durationMs: 5 };
  }

  pulls = 0;

  async pull(since: number): Promise<ApiResult<SyncPullResponse>> {
    this.pulls += 1;
    return { data: await this.pullImpl(since), requestId: 'req-pull', durationMs: 5 };
  }

  async row(table: string, id: string): Promise<unknown> {
    return this.rows.get(`${table}/${id}`) ?? null;
  }

  async uploadAttachment(): Promise<ApiResult<void>> {
    return { data: undefined, requestId: 'req-upload', durationMs: 5 };
  }
}

/** Sesión de mentira: el sync solo lee su estado. */
class FakeAuth {
  readonly state = signal<AuthState>('authenticated');
}

function newFuelEntry(vehicleId: string): NewRow<FuelEntry> {
  return {
    user_id: null, vehicle_id: vehicleId, station_id: null,
    filled_at: new Date().toISOString(), odometer_km: 100, fuel_grade: 'premium',
    input_mode: 'by_liters', amount_paid: null, price_per_liter: null, liters: 25,
    gauge_before: null, gauge_after: null, gauge_total_segments: 8,
    is_full_tank: false, is_partial: true, missed_previous: false,
    liters_before_est: null, liters_after_est: null, distance_km: null,
    km_per_liter: null, cost_per_km: null, efficiency_method: 'none',
    is_efficiency_outlier: false, recomputed_at: null, notes: null,
  };
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
  let auth: FakeAuth;

  beforeEach(async () => {
    api = new FakeApi();
    auth = new FakeAuth();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    });
    sync = TestBed.inject(SyncService);
    store = TestBed.inject(OfflineStore);

    await db.open();
    await Promise.all([
      db.vehicles.clear(),
      db.fuel_entries.clear(),
      db.sync_outbox.clear(),
      db.sync_state.clear(),
      db.sync_runs.clear(),
      db.sync_log.clear(),
      db.attachments.clear(),
      db.attachment_blobs.clear(),
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
  });

  it('no adelanta el cursor con el server_rev del push', async () => {
    // Otro dispositivo pudo subir un rev menor que aún no se ha jalado:
    // adelantar el cursor con el del push se lo saltaría para siempre.
    await store.create<Vehicle>('vehicles', newVehicle());

    await sync.sync();

    expect((await db.sync_state.get(GLOBAL_CURSOR))?.last_rev ?? 0).toBe(0);
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
      throw new RetriableApiError('sin red', 0, { requestId: 'req-caido' });
    };

    await sync.sync();

    const [entry] = await db.sync_outbox.toArray();
    expect(entry.status).toBe('pending');
    expect(entry.attempts).toBe(1);
    // Con red pero sin respuesta: el servidor no contestó, y se sabe con qué id.
    expect(entry.last_attempt).toMatchObject({
      kind: 'server_unreachable',
      message: 'sin red',
      request_id: 'req-caido',
      http_status: null,
    });
    // La próxima vez no se intenta de inmediato: eso es el backoff.
    expect(entry.next_retry_at > new Date().toISOString()).toBe(true);
    expect(sync.status()).toBe('error');
  });

  it('un fallo transitorio nunca pasa a fallido, por muchos intentos que lleve', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.filter((e) => e.row_id === vehicle.id).modify({ attempts: 50 });
    api.pushImpl = async () => {
      throw new RetriableApiError('Algo falló en el servidor.', 500, { code: 'server_error', requestId: 'req-500' });
    };

    await sync.sync();

    const [entry] = await db.sync_outbox.toArray();
    expect(entry.status).toBe('pending');
    expect(entry.last_attempt).toMatchObject({ kind: 'server_error', http_status: 500, request_id: 'req-500' });
  });

  it('marca como fallida la mutación que el servidor rechaza, con su diagnóstico', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => ({
      applied: [],
      rejected: [{
        table: 'vehicles', id: vehicle.id, code: 'validation_failed',
        message: 'El año no es válido.', errors: { year: ['El año no es válido.'] },
      }],
      server_rev: 0,
    });

    await sync.sync();

    const [entry] = await db.sync_outbox.toArray();
    // Se saca de la cola activa para que no bloquee lo que viene detrás.
    expect(entry.status).toBe('failed');
    expect(entry.last_attempt).toMatchObject({
      kind: 'validation', code: 'validation_failed', request_id: 'req-push',
      field_errors: { year: ['El año no es válido.'] },
    });
    const [log] = await db.sync_log.toArray();
    expect(log).toMatchObject({ outcome: 'rejected', request_id: 'req-push', row_id: vehicle.id });
  });

  it('un rechazo de lote entero se parte hasta aislar la fila culpable', async () => {
    const good = await store.create<Vehicle>('vehicles', newVehicle());
    const bad = await store.create<Vehicle>('vehicles', { ...newVehicle(), make: 'MALO' });
    api.pushImpl = async (mutations) => {
      if (mutations.some((m) => m.id === bad.id)) {
        throw new PermanentApiError('Hay datos que corregir.', 422, { code: 'validation_failed' });
      }
      return { applied: mutations.map((m) => ({ table: m.table as never, id: m.id, rev: 5 })), rejected: [], server_rev: 5 };
    };

    await sync.sync();

    const left = await db.sync_outbox.toArray();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ row_id: bad.id, status: 'failed' });
    expect((await db.vehicles.get(good.id))!.rev).toBe(5);
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

  it('no pisa una copia local de una versión posterior (rev mayor)', async () => {
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

  it('una respuesta stale borra la entrada y no toca el rev local', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => ({
      applied: [{ table: 'vehicles', id: vehicle.id, rev: 77, stale: true }],
      rejected: [],
      server_rev: 77,
    });

    await sync.sync();

    expect(await db.sync_outbox.count()).toBe(0);
    expect((await db.vehicles.get(vehicle.id))!.rev).toBe(0);
    expect((await db.sync_log.toArray())[0].outcome).toBe('stale');
  });

  it('compara client_updated_at como fecha y no como texto', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.clear();
    await db.vehicles.update(vehicle.id, { client_updated_at: '2026-09-01T00:00:00.500Z' });

    api.pullImpl = async () => ({
      changes: {
        vehicles: [{ ...vehicle, make: 'Más nuevo', client_updated_at: '2026-09-01T00:00:00.600000Z', rev: 3 } as never],
      },
      server_rev: 3,
      has_more: false,
    });

    await sync.sync();

    expect((await db.vehicles.get(vehicle.id))!.make).toBe('Más nuevo');
  });

  it('un hijo cuyo padre fue rechazado queda bloqueado y se suelta cuando el padre sube', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async (mutations) => ({
      applied: [],
      rejected: mutations.map((m) => ({ table: m.table as never, id: m.id, code: 'validation_failed' as const, message: 'x' })),
      server_rev: 0,
    });
    await sync.sync();

    await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));
    api.pushed = [];
    await sync.sync();

    // No se manda: solo produciría un parent_missing.
    expect(api.pushed).toHaveLength(0);
    const child = (await db.sync_outbox.filter((e) => e.table_name === 'fuel_entries').toArray())[0];
    expect(child).toMatchObject({ status: 'blocked', blocked_by: { table: 'vehicles', id: vehicle.id } });
    expect(await sync.dependentsOf((await db.sync_outbox.filter((e) => e.row_id === vehicle.id).first())!.id))
      .toHaveLength(1);

    api.pushImpl = new FakeApi().pushImpl;
    await sync.retryAll();

    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('parent_missing del servidor bloquea al hijo si el padre sigue en cola', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.filter((e) => e.row_id === vehicle.id).modify({
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const entry = await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));

    await sync.sync();

    // El padre espera su backoff: el hijo espera con él en vez de mandarse.
    expect(api.pushed).toHaveLength(0);
    const child = (await db.sync_outbox.filter((e) => e.row_id === entry.id).first())!;
    expect(child.status).toBe('pending');
    expect(Date.parse(child.next_retry_at)).toBeGreaterThan(Date.now());
  });

  it('descartar un insert nunca subido borra la fila local y sus dependientes', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    const fuel = await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));
    const entry = (await db.sync_outbox.filter((e) => e.row_id === vehicle.id).first())!;

    await sync.discard(entry.id);

    expect(await db.sync_outbox.count()).toBe(0);
    expect(await db.vehicles.get(vehicle.id)).toBeUndefined();
    expect(await db.fuel_entries.get(fuel.id)).toBeUndefined();
    expect((await db.sync_log.toArray()).map((log) => log.outcome)).toEqual(['discarded', 'discarded']);
  });

  it('descartar una edición restaura la versión del servidor', async () => {
    const vehicle = await store.create<Vehicle>('vehicles', newVehicle());
    await sync.sync();
    await store.update<Vehicle>('vehicles', vehicle.id, { make: 'Editado' });
    api.rows.set(`vehicles/${vehicle.id}`, { ...vehicle, make: 'Del servidor', rev: 100 });

    await sync.discard((await db.sync_outbox.toArray())[0].id);

    expect((await db.vehicles.get(vehicle.id))!.make).toBe('Del servidor');
    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('guarda el ciclo en el historial con sus request ids', async () => {
    await store.create<Vehicle>('vehicles', newVehicle());

    await sync.sync();

    const [run] = await db.sync_runs.toArray();
    expect(run).toMatchObject({ outcome: 'ok', pushed: 1, applied: 1, trigger: 'manual' });
    expect(run.request_ids).toEqual(['req-push', 'req-pull']);
    expect(sync.lastSyncedAt()).not.toBeNull();
  });

  it('recupera lo que quedó en vuelo de un ciclo interrumpido', async () => {
    await store.create<Vehicle>('vehicles', newVehicle());
    await db.sync_outbox.toCollection().modify({ status: 'in_flight' });

    await sync.sync();

    expect(await db.sync_outbox.count()).toBe(0);
  });

  it('la revisión de respaldo no toca la red si no hay nada por subir', async () => {
    await sync.sync('interval');
    expect(api.pulls).toBe(0);

    await store.create<Vehicle>('vehicles', newVehicle());
    await sync.sync('interval');
    expect(api.pushed).toHaveLength(1);
  });

  it('al volver a la app sin pendientes solo jala si el último sync es viejo', async () => {
    await sync.sync('manual');
    api.pulls = 0;

    await sync.sync('focus');
    expect(api.pulls).toBe(0);

    await db.sync_state.update(GLOBAL_CURSOR, { last_synced_at: '2020-01-01T00:00:00.000Z' });
    await vi.waitFor(() => expect(sync.lastSyncedAt()).toBe('2020-01-01T00:00:00.000Z'));
    await sync.sync('focus');
    expect(api.pulls).toBe(1);
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

  // ── Sesión ──────────────────────────────────────────────────────────────

  it('un 401 pausa el sync sin gastar intentos ni marcar fallidos', async () => {
    await store.create<Vehicle>('vehicles', newVehicle());
    api.pushImpl = async () => {
      throw new AuthRequiredError('Sesión no válida o expirada.');
    };

    await sync.sync();

    // La mutación es válida; solo falta quien la firme. Tiene que seguir
    // exactamente como estaba para salir en cuanto haya login.
    const [entry] = await db.sync_outbox.toArray();
    expect(entry.status).toBe('pending');
    expect(entry.attempts).toBe(0);
    expect(sync.status()).toBe('unauthorized');
  });

  it('con la sesión expirada no manda nada', async () => {
    auth.state.set('expired');
    await store.create<Vehicle>('vehicles', newVehicle());

    await sync.sync();

    expect(api.pushed).toHaveLength(0);
    expect(sync.status()).toBe('unauthorized');
    expect(await db.sync_outbox.count()).toBe(1);
  });

  it('solo deja cerrar sesión cuando no queda nada por enviar', async () => {
    // El outbox de las pruebas anteriores ya se vació en el beforeEach.
    TestBed.tick();
    await vi.waitFor(() => expect(sync.canLogout()).toBe(true));

    await store.create<Vehicle>('vehicles', newVehicle());
    await vi.waitFor(() => expect(sync.logoutBlocker()).toBe('pending'));

    await sync.sync();
    await vi.waitFor(() => expect(sync.canLogout()).toBe(true));

    auth.state.set('expired');
    expect(sync.logoutBlocker()).toBe('expired');
  });

  describe('conflictos', () => {
    /** Un vehículo que ya está en el servidor con rev 100, sin nada en cola. */
    async function syncedVehicle(overrides: Partial<NewRow<Vehicle>> = {}): Promise<Vehicle> {
      const vehicle = await store.create<Vehicle>('vehicles', { ...newVehicle(), ...overrides });
      await sync.sync();
      api.pushed = [];
      return (await db.vehicles.get(vehicle.id))!;
    }

    /** El servidor responde que la fila choca. Solo la primera vez: luego vuelve a aceptar todo. */
    function conflictOnce(detail: (m: SyncPushMutation) => SyncConflictDetail, code: 'conflict' | 'parent_deleted' = 'conflict'): void {
      const accept = api.pushImpl;
      let used = false;
      api.pushImpl = async (mutations) => {
        if (used) return accept(mutations);
        used = true;
        const [first, ...rest] = mutations;
        const accepted = rest.length > 0 ? await accept(rest) : { applied: [], rejected: [], server_rev: 0 };
        return {
          ...accepted,
          rejected: [
            ...accepted.rejected,
            { table: first.table, id: first.id, code, message: 'choque', conflict: detail(first) },
          ],
        };
      };
    }

    function serverVersion(vehicle: Vehicle, changes: Partial<Vehicle>): SyncFields {
      return { ...vehicle, rev: 200, ...changes } as SyncFields;
    }

    it('manda base_rev y la fila que vio el usuario', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'uno' });
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'dos' });

      await sync.sync();

      const [mutation] = api.pushed[0];
      expect(mutation.base_rev).toBe(100);
      // La base es la de ANTES del primer cambio, no la de la edición anterior.
      expect(mutation.base?.['notes']).toBeNull();
      expect(mutation.payload?.['notes']).toBe('dos');
    });

    it('una entrada vieja sin base_rev sube con last-write-wins', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'x' });
      await db.sync_outbox.toCollection().modify({ base_rev: null, base: null });

      await sync.sync();

      expect(api.pushed[0][0]).not.toHaveProperty('base_rev');
    });

    it('aparta el conflicto, conserva mi versión y no lo reintenta', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { license_plate: 'MIA-1' });
      conflictOnce(() => ({
        kind: 'edit_edit',
        fields: ['license_plate'],
        server_row: serverVersion(vehicle, { license_plate: 'SRV-1' }),
        server_rev: 200,
      }));
      api.pullImpl = async () => ({
        changes: { vehicles: [serverVersion(vehicle, { license_plate: 'SRV-1' })] },
        server_rev: 200,
        has_more: false,
      });

      await sync.sync();

      const [entry] = await db.sync_outbox.toArray();
      expect(entry.status).toBe('conflict');
      expect(entry.conflict).toMatchObject({ kind: 'edit_edit', fields: ['license_plate'], server_rev: 200, request_id: 'req-push' });
      // El pull no pisa la fila mientras haya conflicto.
      expect((await db.vehicles.get(vehicle.id))!.license_plate).toBe('MIA-1');
      expect((await db.sync_log.toArray()).map((e) => e.outcome)).toContain('conflict');

      api.pushed = [];
      await sync.sync();
      expect(api.pushed).toHaveLength(0);

      await vi.waitFor(() => expect(sync.logoutBlocker()).toBe('conflict'));
      expect(sync.summary().conflicts).toBe(1);
      expect(sync.summary().health).toBe('conflict');
    });

    it('bloquea lo que depende de un conflicto y lo suelta al resolverlo', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { license_plate: 'MIA-1' });
      conflictOnce(() => ({
        kind: 'edit_edit',
        fields: ['license_plate'],
        server_row: serverVersion(vehicle, { license_plate: 'SRV-1' }),
        server_rev: 200,
      }));
      await sync.sync();

      await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));
      await sync.sync();
      const child = (await db.sync_outbox.toArray()).find((e) => e.table_name === 'fuel_entries')!;
      expect(child.status).toBe('blocked');
      expect(child.blocked_by).toEqual({ table: 'vehicles', id: vehicle.id });

      const conflict = (await db.sync_outbox.toArray()).find((e) => e.status === 'conflict')!;
      await sync.resolveKeepMine(conflict.id);

      expect(await db.sync_outbox.count()).toBe(0);
      const [vehicleMutation] = api.pushed.at(-1)!;
      expect(vehicleMutation).toMatchObject({ table: 'vehicles', base_rev: 200 });
      expect(vehicleMutation.payload?.['license_plate']).toBe('MIA-1');
    });

    it('elegir por campo combina mi versión, la del servidor y lo que no chocaba', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { license_plate: 'MIA-1', color: 'Rojo', notes: 'mía' });
      const theirs = serverVersion(vehicle, { license_plate: 'SRV-1', color: 'Azul', year: 2023 });
      conflictOnce(() => ({ kind: 'edit_edit', fields: ['color', 'license_plate'], server_row: theirs, server_rev: 200 }));
      await sync.sync();
      const entry = (await db.sync_outbox.toArray())[0];

      // Retiene el push para ver la entrada ya resuelta.
      api.pushImpl = async () => {
        throw new RetriableApiError('caído', 503);
      };
      await sync.resolveFields(entry.id, { license_plate: 'theirs', color: 'mine' });

      const resolved = (await db.sync_outbox.get(entry.id))!;
      const payload = JSON.parse(resolved.payload!) as Vehicle;
      expect(resolved).toMatchObject({ status: 'pending', base_rev: 200, conflict: null });
      expect(payload.license_plate).toBe('SRV-1');
      expect(payload.color).toBe('Rojo');
      expect(payload.notes).toBe('mía');
      expect(payload.year).toBe(2023);
      expect(JSON.parse(resolved.base!).license_plate).toBe('SRV-1');
      expect((await db.vehicles.get(vehicle.id))!.year).toBe(2023);
      expect((await db.sync_log.toArray()).map((e) => e.outcome)).toContain('resolved_fields');
    });

    it('usar la del servidor sin otros cambios adopta su versión y vacía la cola', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { license_plate: 'MIA-1' });
      const theirs = serverVersion(vehicle, { license_plate: 'SRV-1' });
      conflictOnce(() => ({ kind: 'edit_edit', fields: ['license_plate'], server_row: theirs, server_rev: 200 }));
      await sync.sync();
      const entry = (await db.sync_outbox.toArray())[0];

      await sync.resolveTakeServer(entry.id);

      expect(await db.sync_outbox.count()).toBe(0);
      expect((await db.vehicles.get(vehicle.id))!).toMatchObject({ license_plate: 'SRV-1', rev: 200 });
      expect((await db.sync_log.toArray()).map((e) => e.outcome)).toContain('resolved_theirs');
    });

    it('restaurar con mis cambios lo reenvía como insert con resolve restore', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'offline' });
      const tombstone = serverVersion(vehicle, { deleted_at: new Date().toISOString() });
      conflictOnce(() => ({ kind: 'edit_delete', fields: ['notes'], server_row: tombstone, server_rev: 200 }));
      await sync.sync();
      const entry = (await db.sync_outbox.toArray())[0];

      await sync.resolveRestore(entry.id);

      const [mutation] = api.pushed.at(-1)!;
      expect(mutation).toMatchObject({ op: 'insert', resolve: 'restore', base_rev: 200 });
      expect(mutation.payload).toMatchObject({ notes: 'offline', deleted_at: null });
    });

    it('aceptar el borrado aplica el tombstone y descarta lo que dependía', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'offline' });
      const fuel = await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));
      const tombstone = serverVersion(vehicle, { deleted_at: new Date().toISOString() });
      // El vehículo choca y la carga queda bloqueada detrás sin llegar al servidor.
      conflictOnce(() => ({ kind: 'edit_delete', fields: ['notes'], server_row: tombstone, server_rev: 200 }));
      const pushOnlyVehicles = api.pushImpl;
      api.pushImpl = (mutations) => pushOnlyVehicles(mutations.filter((m) => m.table === 'vehicles'));
      await sync.sync();
      const entry = (await db.sync_outbox.toArray()).find((e) => e.status === 'conflict')!;

      expect(await sync.dependentsOf(entry.id)).toHaveLength(1);
      await sync.resolveAcceptDelete(entry.id);

      expect(await db.sync_outbox.count()).toBe(0);
      expect((await db.vehicles.get(vehicle.id))!.deleted_at).not.toBeNull();
      // La carga nunca llegó al servidor: se borra de este dispositivo.
      expect(await db.fuel_entries.get(fuel.id)).toBeUndefined();
      expect((await db.sync_log.toArray()).map((e) => e.outcome)).toContain('resolved_accept_delete');
    });

    it('un hijo de un padre borrado sin conflicto local es un conflicto propio', async () => {
      const vehicle = await syncedVehicle();
      await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));
      const tombstone = serverVersion(vehicle, { deleted_at: new Date().toISOString() });
      conflictOnce(
        () => ({
          kind: 'create_in_deleted_parent',
          fields: ['vehicle_id'],
          server_row: tombstone,
          server_rev: 200,
          parent: { table: 'vehicles', id: vehicle.id },
        }),
        'parent_deleted',
      );

      await sync.sync();

      const [entry] = await db.sync_outbox.toArray();
      expect(entry.status).toBe('conflict');
      expect(entry.conflict?.kind).toBe('create_in_deleted_parent');
      expect(entry.last_attempt?.kind).toBe('parent_deleted');

      // Restaurar el padre lo encola como restore y el hijo sube detrás.
      expect(await sync.resolveRestoreParent(entry.id)).toBeNull();
      const [parentMutation, childMutation] = api.pushed.at(-1)!;
      expect(parentMutation).toMatchObject({ table: 'vehicles', op: 'insert', resolve: 'restore', base_rev: 200 });
      expect(childMutation.table).toBe('fuel_entries');
      expect(await db.sync_outbox.count()).toBe(0);
    });

    it('un hijo de un padre borrado queda detrás del conflicto del padre', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'offline' });
      await store.create<FuelEntry>('fuel_entries', newFuelEntry(vehicle.id));
      const tombstone = serverVersion(vehicle, { deleted_at: new Date().toISOString() });
      api.pushImpl = async (mutations) => ({
        applied: [],
        rejected: mutations.map((m) =>
          m.table === 'vehicles'
            ? { table: m.table, id: m.id, code: 'conflict' as const, message: 'x',
                conflict: { kind: 'edit_delete' as const, fields: ['notes'], server_row: tombstone, server_rev: 200 } }
            : { table: m.table, id: m.id, code: 'parent_deleted' as const, message: 'x',
                conflict: { kind: 'create_in_deleted_parent' as const, fields: ['vehicle_id'], server_row: tombstone,
                  server_rev: 200, parent: { table: 'vehicles' as const, id: vehicle.id } } },
        ),
        server_rev: 0,
      });

      await sync.sync();

      const entries = await db.sync_outbox.toArray();
      expect(entries.find((e) => e.table_name === 'vehicles')!.status).toBe('conflict');
      const child = entries.find((e) => e.table_name === 'fuel_entries')!;
      expect(child).toMatchObject({ status: 'blocked', blocked_by: { table: 'vehicles', id: vehicle.id }, conflict: null });
    });

    it('guarda la fila mezclada que devuelve el servidor', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'mía' });
      const merged = serverVersion(vehicle, { notes: 'mía', license_plate: 'DE-OTRO', rev: 300 } as Partial<Vehicle>);
      api.pushImpl = async (mutations) => ({
        applied: mutations.map((m) => ({ table: m.table, id: m.id, rev: 300, row: merged, merged: ['license_plate'] })),
        rejected: [],
        server_rev: 300,
      });

      await sync.sync();

      expect((await db.vehicles.get(vehicle.id))!).toMatchObject({ notes: 'mía', license_plate: 'DE-OTRO', rev: 300 });
      expect((await db.sync_log.toArray()).map((e) => e.outcome)).toContain('merged');
    });

    it('si edité mientras subía, mueve la base de la entrada nueva a lo que quedó en el servidor', async () => {
      const vehicle = await syncedVehicle();
      await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'uno' });
      const saved = serverVersion(vehicle, { notes: 'uno', rev: 300 } as Partial<Vehicle>);
      let edited = false;
      api.pushImpl = async (mutations) => {
        if (!edited) {
          edited = true;
          // El usuario edita mientras la petición viaja.
          await store.update<Vehicle>('vehicles', vehicle.id, { notes: 'dos' });
        }
        return {
          applied: mutations.map((m) => ({ table: m.table, id: m.id, rev: 300, row: saved })),
          rejected: [],
          server_rev: 300,
        };
      };

      await sync.sync();
      await sync.sync();

      // La segunda vuelta sube "dos" sobre rev 300, no sobre la base vieja.
      const second = api.pushed[1][0];
      expect(second.base_rev).toBe(300);
      expect(second.base?.['notes']).toBe('uno');
      expect(second.payload?.['notes']).toBe('dos');
    });

    it('el pull decide por rev y no por el reloj del dispositivo', async () => {
      const vehicle = await syncedVehicle();
      // El otro dispositivo tiene el reloj atrasado un día.
      const late = new Date(Date.now() - 86_400_000).toISOString();
      api.pullImpl = async () => ({
        changes: { vehicles: [serverVersion(vehicle, { notes: 'del otro', client_updated_at: late })] },
        server_rev: 200,
        has_more: false,
      });

      await sync.sync();

      expect((await db.vehicles.get(vehicle.id))!.notes).toBe('del otro');
    });
  });
});
