import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api/api.service';
import { db } from '../db/piston-db';
import { CURRENT, type AuthUser, type OnboardingState } from '../models';
import { AuthService } from './auth.service';
import { OnboardingService } from './onboarding.service';

class FakeAuth {
  readonly state = signal<'authenticated' | 'expired'>('authenticated');
  readonly serverUser = signal<AuthUser | null>(null);
  updateUser = vi.fn(async () => {});
}

function server(
  step: OnboardingState['step'],
  updatedAt: string | null,
  draft = {},
): OnboardingState {
  return { step, draft, updated_at: updatedAt, completed_at: null };
}

describe('OnboardingService', () => {
  let service: OnboardingService;
  let api: {
    saveOnboarding: ReturnType<typeof vi.fn>;
    completeOnboarding: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = { saveOnboarding: vi.fn(), completeOnboarding: vi.fn(), updateProfile: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: new FakeAuth() },
      ],
    });
    service = TestBed.inject(OnboardingService);
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  });

  it('guarda cada cambio al instante y retoma en el mismo paso', async () => {
    await service.save('tank', { vehicle: { make: 'Mazda', gauge_total_segments: 10 } });

    // Como si la app se cerrara y se volviera a abrir: todo sale de IndexedDB.
    const row = await db.onboarding.get(CURRENT);
    expect(row?.step).toBe('tank');
    expect(row?.draft?.vehicle?.gauge_total_segments).toBe(10);
    expect(row?.dirty).toBe(true);
    expect(await service.currentStep()).toBe('tank');
  });

  it('un login en otro dispositivo trae el progreso más reciente del servidor', async () => {
    await service.save('vehicle', { vehicle: { make: 'Viejo' } });
    const local = await db.onboarding.get(CURRENT);

    const later = new Date(Date.parse(local!.updated_at!) + 60_000).toISOString();
    await service.reconcile(server('purchase', later, { vehicle: { make: 'Nuevo' } }));

    const row = await db.onboarding.get(CURRENT);
    expect(row?.step).toBe('purchase');
    expect(row?.draft?.vehicle?.make).toBe('Nuevo');
  });

  it('el borrador local sin subir gana sobre uno más viejo del servidor', async () => {
    await service.save('tank', { vehicle: { make: 'Local' } });

    await service.reconcile(
      server('vehicle', '2020-01-01T00:00:00.000Z', { vehicle: { make: 'Viejo' } }),
    );

    expect((await db.onboarding.get(CURRENT))?.draft?.vehicle?.make).toBe('Local');
  });

  it('terminar crea el vehículo y su odómetro en la misma transacción que cierra el wizard', async () => {
    await service.save('review', {
      vehicle: {
        make: 'Mazda',
        model: '3',
        year: 2022,
        tank_capacity_l: 51,
        gauge_total_segments: 8,
        current_odometer_km: 48_250,
        license_plate: 'abc-123-d',
      },
    });

    const vehicle = await service.finish();

    expect(vehicle.plate_last_digit).toBe(3);
    expect(vehicle.license_plate).toBe('ABC-123-D');
    expect(vehicle.is_primary).toBe(true);
    expect(await db.odometer_readings.count()).toBe(1);
    expect((await db.onboarding.get(CURRENT))?.step).toBe('done');
    // Vehículo + lectura esperando en el outbox; el draft ya no existe.
    expect(await db.sync_outbox.count()).toBe(2);
    expect((await db.onboarding.get(CURRENT))?.draft).toBeNull();
  });

  it('el servidor en done cierra el wizard aunque lo local sea más nuevo', async () => {
    await service.save('tank', {});

    await service.reconcile({
      step: 'done',
      draft: null,
      updated_at: '2020-01-01T00:00:00.000Z',
      completed_at: '2020-01-01T00:00:00.000Z',
    });

    expect(await service.currentStep()).toBe('done');
  });
});
