import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { liveQuery } from 'dexie';
import { ApiService, AuthRequiredError } from '../api/api.service';
import { OfflineStore } from '../data/offline-store.service';
import { db } from '../db/piston-db';
import {
  CURRENT,
  type LocalOnboarding,
  type OdometerReading,
  type OnboardingDraft,
  type OnboardingState,
  type OnboardingStep,
  type Vehicle,
} from '../models';
import { AuthService } from './auth.service';

/** Espera tras la última edición antes de subir el borrador. */
const FLUSH_DEBOUNCE_MS = 1_500;

/** Resultado de leer la tabla local: `undefined` = aún no se sabe. */
type Loaded = LocalOnboarding | null | undefined;

/**
 * Progreso del wizard de bienvenida.
 *
 * Se escribe PRIMERO en IndexedDB, en cada cambio, para que cerrar la app a
 * media captura no pierda nada (el caso típico: salir al coche a contar las
 * rayitas del medidor). Después se sube al servidor cuando se puede, para
 * poder retomarlo en otro dispositivo.
 *
 * Ninguna fila de dominio se crea hasta el último paso. Un vehículo a medias
 * en el outbox viajaría al servidor y aparecería en otros dispositivos.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly store = inject(OfflineStore);

  private readonly _local = signal<Loaded>(undefined);
  readonly local = this._local.asReadonly();

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor() {
    liveQuery(() => db.onboarding.get(CURRENT)).subscribe({
      next: (row) => this._local.set(row ?? null),
    });
    globalThis.addEventListener?.('online', () => void this.flush());

    // Cada login o refresh trae el onboarding del servidor: se junta con el
    // local para retomar en el paso correcto aunque se haya avanzado en otro
    // dispositivo.
    effect(() => {
      const server = this.auth.serverUser()?.onboarding;
      if (server) {
        untracked(() => void this.reconcile(server));
      }
    });
  }

  /** Paso actual según la copia local, leyendo IndexedDB si aún no llegó el liveQuery. */
  async currentStep(): Promise<OnboardingStep | null> {
    const row = await db.onboarding.get(CURRENT);
    return row?.step ?? null;
  }

  /**
   * Junta la copia local con la del servidor tras un login o un refresh.
   *
   * Gana el `updated_at` más reciente, salvo que el servidor ya diga `done`:
   * terminar es definitivo y ningún borrador viejo lo reabre.
   */
  async reconcile(server: OnboardingState): Promise<void> {
    const local = await db.onboarding.get(CURRENT);
    const serverWins =
      !local ||
      server.step === 'done' ||
      (!local.dirty && local.step !== 'done') ||
      (server.updated_at !== null &&
        (local.updated_at === null || server.updated_at > local.updated_at));

    if (serverWins) {
      await db.onboarding.put({
        key: CURRENT,
        ...server,
        dirty: false,
        profile_dirty: local?.profile_dirty ?? false,
      });
      return;
    }

    void this.flush();
  }

  /** Guarda un cambio del wizard. Local al instante; al servidor con debounce. */
  async save(
    step: Exclude<OnboardingStep, 'done'>,
    draft: OnboardingDraft,
    profileChanged = false,
  ): Promise<void> {
    const current = await db.onboarding.get(CURRENT);
    await db.onboarding.put({
      key: CURRENT,
      step,
      draft,
      updated_at: new Date().toISOString(),
      completed_at: null,
      dirty: true,
      profile_dirty: profileChanged || (current?.profile_dirty ?? false),
    });
    this.scheduleFlush();
  }

  /**
   * Último paso: crea el vehículo y su primera lectura de odómetro, y cierra el
   * wizard. Todo en una transacción: o existe el vehículo Y el wizard está
   * terminado, o ninguna de las dos cosas.
   */
  async finish(): Promise<Vehicle> {
    const local = await db.onboarding.get(CURRENT);
    const v = local?.draft?.vehicle;
    if (!local || !v?.make || !v.model || !v.year || !v.tank_capacity_l) {
      throw new Error('Faltan datos del vehículo.');
    }

    const now = new Date().toISOString();
    const currentKm = v.current_odometer_km ?? v.purchase_odometer_km ?? 0;
    let vehicle!: Vehicle;

    await db.transaction(
      'rw',
      [db.vehicles, db.odometer_readings, db.sync_outbox, db.onboarding],
      async () => {
        vehicle = await this.store.create<Vehicle>('vehicles', {
          user_id: null,
          nickname: blankToNull(v.nickname),
          make: v.make!.trim(),
          model: v.model!.trim(),
          year: v.year!,
          trim: null,
          vehicle_type: v.vehicle_type ?? 'car',
          transmission: v.transmission ?? null,
          engine_displacement_l: null,
          color: null,
          vin: null,
          license_plate: blankToNull(v.license_plate)?.toUpperCase() ?? null,
          plate_last_digit: lastDigit(v.license_plate),
          emissions_sticker: v.emissions_sticker ?? 'none',
          default_fuel_grade: v.default_fuel_grade ?? 'regular',
          tank_capacity_l: v.tank_capacity_l!,
          gauge_total_segments: v.gauge_total_segments ?? 8,
          factory_km_per_liter: null,
          oil_capacity_l: null,
          oil_spec: null,
          tire_pressure_front_psi: null,
          tire_pressure_rear_psi: null,
          current_odometer_km: currentKm,
          purchase_date: v.purchase_date ?? null,
          purchase_price: v.purchase_price ?? null,
          purchase_odometer_km: v.purchase_odometer_km ?? null,
          sale_date: null,
          sale_price: null,
          sale_odometer_km: null,
          status: 'active',
          is_primary: true,
          notes: null,
        });

        if (currentKm > 0) {
          await this.store.create<OdometerReading>('odometer_readings', {
            user_id: null,
            vehicle_id: vehicle.id,
            read_at: now,
            km: currentKm,
            source: 'manual',
            source_id: null,
            is_suspect: false,
          });
        }

        await db.onboarding.put({
          ...local,
          step: 'done',
          draft: null,
          updated_at: now,
          completed_at: now,
          dirty: true,
        });
      },
    );

    void this.flush();
    return vehicle;
  }

  /**
   * Sube lo pendiente: perfil y progreso. Silencioso ante cualquier fallo; lo
   * que no sube hoy queda `dirty` y se reintenta en el próximo `online`,
   * refresh o sync.
   */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (this.auth.state() !== 'authenticated' || !navigator.onLine) {
      return;
    }

    const local = await db.onboarding.get(CURRENT);
    if (!local || (!local.dirty && !local.profile_dirty)) {
      return;
    }

    try {
      if (local.profile_dirty && local.draft?.account) {
        const { name, currency, distance_unit, volume_unit } = local.draft.account;
        const user = await this.api.updateProfile(
          stripEmpty({ name: name?.trim(), currency, distance_unit, volume_unit }),
        );
        await this.auth.updateUser(user);
      }
      if (local.profile_dirty) {
        await db.onboarding.update(CURRENT, { profile_dirty: false });
      }

      if (!local.dirty) {
        return;
      }

      const user =
        local.step === 'done'
          ? await this.api.completeOnboarding()
          : await this.api.saveOnboarding(
              local.step,
              local.draft,
              local.updated_at ?? new Date().toISOString(),
            );
      await this.auth.updateUser(user);

      // Si el usuario siguió escribiendo mientras subía, lo local es más
      // nuevo que lo enviado: se queda `dirty` para la siguiente vuelta.
      await db.transaction('rw', db.onboarding, async () => {
        const latest = await db.onboarding.get(CURRENT);
        if (latest && latest.updated_at === local.updated_at) {
          await db.onboarding.put({
            key: CURRENT,
            ...user.onboarding,
            dirty: false,
            profile_dirty: latest.profile_dirty,
          });
        }
      });
    } catch (error) {
      if (!(error instanceof AuthRequiredError)) {
        console.warn('[onboarding] No se pudo subir el progreso; se reintentará.', error);
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** La terminación de placa decide el calendario de verificación. */
function lastDigit(plate: string | null | undefined): number | null {
  const digits = plate?.match(/\d/g);
  return digits ? Number(digits[digits.length - 1]) : null;
}

function stripEmpty<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}
