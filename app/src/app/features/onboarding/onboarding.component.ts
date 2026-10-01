import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, PermanentApiError } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { OnboardingService } from '../../core/auth/onboarding.service';
import type { OnboardingDraft, OnboardingStep } from '../../core/models';
import {
  CURRENCIES,
  DISTANCE_UNITS,
  VOLUME_UNITS,
  fromBaseDistance,
  fromBaseVolume,
  toBaseOdometer,
  toBaseVolume,
  type DistanceUnit,
  type VolumeUnit,
} from '../../core/units';
import { SyncService } from '../../core/sync/sync.service';
import { GaugeComponent } from '../../shared/gauge/gauge.component';
import { IconComponent } from '../../shared/icon/icon.component';
import {
  FUEL_GRADES,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  STICKERS,
  TRANSMISSIONS,
  VEHICLE_TYPES,
  type Option,
} from '../vehicles/vehicle-options';

type WizardStep = Exclude<OnboardingStep, 'done'>;
type VehicleDraft = NonNullable<OnboardingDraft['vehicle']>;
type AccountDraft = NonNullable<OnboardingDraft['account']>;

const STEPS: readonly { readonly id: WizardStep; readonly title: string; readonly sub: string }[] =
  [
    { id: 'account', title: 'Tu cuenta', sub: 'Cómo te llamamos y en qué unidades trabajas.' },
    { id: 'vehicle', title: 'Tu vehículo', sub: 'Lo básico para reconocerlo en la app.' },
    {
      id: 'tank',
      title: 'Tanque y rayitas',
      sub: 'Con esto Piston convierte las rayitas del medidor en litros.',
    },
    {
      id: 'purchase',
      title: 'Kilometraje',
      sub: 'El punto de partida para rendimiento y servicios.',
    },
    {
      id: 'review',
      title: 'Todo listo',
      sub: 'Revisa antes de empezar. Podrás cambiarlo después.',
    },
  ];

const THIS_YEAR = new Date().getFullYear();

/**
 * Wizard de bienvenida: cuenta + primer vehículo.
 *
 * Cada tecla se guarda (IndexedDB al instante, servidor con debounce), así que
 * cerrar la app a medias no pierde nada. El caso para el que está pensado:
 * llegar al paso de las rayitas, salir al coche a contarlas y volver horas
 * después al mismo paso con todo lo demás ya escrito.
 */
@Component({
  selector: 'pst-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GaugeComponent, IconComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent {
  private readonly onboarding = inject(OnboardingService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);

  protected readonly steps = STEPS;
  protected readonly step = signal<WizardStep>('account');
  protected readonly draft = signal<OnboardingDraft>({});
  protected readonly hydrated = signal(false);
  protected readonly online = this.sync.online;
  protected readonly email = computed(() => this.auth.user()?.email ?? '');

  protected readonly index = computed(() => STEPS.findIndex((s) => s.id === this.step()));
  protected readonly current = computed(() => STEPS[this.index()]);
  protected readonly account = computed<AccountDraft>(() => this.draft().account ?? {});
  protected readonly vehicle = computed<VehicleDraft>(() => this.draft().vehicle ?? {});
  protected readonly segments = computed(() => this.vehicle().gauge_total_segments ?? 8);
  /** Litros por rayita, si la capacidad ya está. Hace tangible para qué sirve el dato. */
  protected readonly litersPerSegment = computed(() => {
    const capacity = fromBaseVolume(this.vehicle().tank_capacity_l ?? null, this.volumeUnit());
    return capacity ? (capacity / this.segments()).toFixed(1) : null;
  });

  protected readonly savedLater = signal(false);
  protected readonly finishing = signal(false);
  protected readonly error = signal<string | null>(null);

  // Cambio de contraseña: fuera del borrador, que se guarda en claro.
  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly passwordBusy = signal(false);
  protected readonly passwordMessage = signal<{ tone: 'good' | 'bad'; text: string } | null>(null);

  protected readonly vehicleTypes = VEHICLE_TYPES;
  protected readonly transmissions = TRANSMISSIONS;
  protected readonly stickers = STICKERS;
  protected readonly fuelGrades = FUEL_GRADES;
  protected readonly currencies: readonly Option<string>[] = CURRENCIES.map((c) => ({
    value: c.code,
    label: c.code,
  }));
  protected readonly distanceUnits: readonly Option<DistanceUnit>[] = Object.values(
    DISTANCE_UNITS,
  ).map((u) => ({ value: u.code, label: u.label }));
  protected readonly volumeUnits: readonly Option<VolumeUnit>[] = Object.values(VOLUME_UNITS).map(
    (u) => ({ value: u.code, label: u.label }),
  );

  /**
   * Unidades elegidas en el primer paso. El borrador guarda SIEMPRE km y
   * litros; estas solo cambian lo que se ve y cómo se lee lo escrito.
   */
  private readonly distanceUnit = computed(() => this.account().distance_unit ?? 'km');
  private readonly volumeUnit = computed(() => this.account().volume_unit ?? 'L');
  protected readonly distanceSymbol = computed(() => DISTANCE_UNITS[this.distanceUnit()].symbol);
  protected readonly volumeSymbol = computed(() => VOLUME_UNITS[this.volumeUnit()].symbol);

  /** Valor guardado (km) mostrado en la unidad elegida. */
  protected distance(km: number | null | undefined): number | string {
    const value = fromBaseDistance(km ?? null, this.distanceUnit());
    return value === null ? '' : Math.round(value);
  }

  protected volume(liters: number | null | undefined): number | string {
    const value = fromBaseVolume(liters ?? null, this.volumeUnit());
    return value === null ? '' : Math.round(value * 100) / 100;
  }

  protected setDistance(key: 'current_odometer_km' | 'purchase_odometer_km', event: Event): void {
    this.setVehicle(key, toBaseOdometer(this.num(event), this.distanceUnit()));
  }

  protected setVolume(key: 'tank_capacity_l', event: Event): void {
    const liters = toBaseVolume(this.num(event), this.volumeUnit());
    this.setVehicle(key, liters === null ? null : Math.round(liters * 100) / 100);
  }

  /** Si el paso actual está completo. Solo entonces se habilita "Siguiente". */
  protected readonly canAdvance = computed(() => {
    const v = this.vehicle();
    switch (this.step()) {
      case 'account':
        return !!this.account().name?.trim();
      case 'vehicle':
        return (
          !!v.make?.trim() &&
          !!v.model?.trim() &&
          !!v.year &&
          v.year >= 1950 &&
          v.year <= THIS_YEAR + 1
        );
      case 'tank':
        return !!v.tank_capacity_l && v.tank_capacity_l > 0 && v.tank_capacity_l <= 500;
      case 'purchase':
        return (
          v.current_odometer_km != null &&
          v.current_odometer_km >= 0 &&
          (v.purchase_odometer_km == null || v.purchase_odometer_km <= v.current_odometer_km)
        );
      case 'review':
        return !this.finishing();
    }
  });

  constructor() {
    // Se hidrata UNA vez desde la copia local. Después la pantalla es la
    // dueña del borrador: re-hidratar con cada cambio de IndexedDB pisaría lo
    // que el usuario está escribiendo con su propia versión de hace un momento.
    effect(() => {
      const local = this.onboarding.local();
      if (local === undefined || untracked(this.hydrated)) {
        return;
      }
      untracked(() => this.hydrate(local?.step, local?.draft ?? null));
    });
  }

  // ── Edición ─────────────────────────────────────────────────────────────

  protected setAccount<K extends keyof AccountDraft>(key: K, value: AccountDraft[K]): void {
    this.draft.update((draft) => ({ ...draft, account: { ...draft.account, [key]: value } }));
    void this.persist(true);
  }

  protected setVehicle<K extends keyof VehicleDraft>(key: K, value: VehicleDraft[K]): void {
    this.draft.update((draft) => ({ ...draft, vehicle: { ...draft.vehicle, [key]: value } }));
    this.savedLater.set(false);
    void this.persist();
  }

  protected bumpSegments(delta: number): void {
    const next = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, this.segments() + delta));
    this.setVehicle('gauge_total_segments', next);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Número o null: un campo vacío es "no sé", no cero. */
  protected num(event: Event): number | null {
    const raw = (event.target as HTMLInputElement).value.trim().replace(',', '.');
    if (raw === '') {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // ── Navegación ──────────────────────────────────────────────────────────

  protected async next(): Promise<void> {
    if (!this.canAdvance()) {
      return;
    }
    if (this.step() === 'review') {
      await this.finish();
      return;
    }
    this.go(STEPS[this.index() + 1].id);
  }

  protected back(): void {
    if (this.index() > 0) {
      this.go(STEPS[this.index() - 1].id);
    }
  }

  /** "Lo confirmo después": el borrador ya está guardado; solo se le dice al usuario. */
  protected async later(): Promise<void> {
    await this.persist();
    this.savedLater.set(true);
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordBusy() || !this.currentPassword() || this.newPassword().length < 8) {
      return;
    }
    this.passwordBusy.set(true);
    this.passwordMessage.set(null);
    try {
      await this.api.updatePassword(this.currentPassword(), this.newPassword());
      this.currentPassword.set('');
      this.newPassword.set('');
      this.passwordMessage.set({ tone: 'good', text: 'Contraseña actualizada.' });
    } catch (error) {
      this.passwordMessage.set({
        tone: 'bad',
        // El servidor ya explica qué campo falló; solo se cae al genérico si
        // no hubo respuesta.
        text:
          error instanceof PermanentApiError
            ? (Object.values(error.errors ?? {})[0]?.[0] ?? error.message)
            : 'No se pudo cambiar ahora. Puedes hacerlo más tarde desde Ajustes.',
      });
    } finally {
      this.passwordBusy.set(false);
    }
  }

  private go(step: WizardStep): void {
    this.step.set(step);
    this.error.set(null);
    this.savedLater.set(false);
    void this.persist();
  }

  private async finish(): Promise<void> {
    this.finishing.set(true);
    this.error.set(null);
    try {
      await this.persist();
      await this.onboarding.finish();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo guardar el vehículo.');
    } finally {
      this.finishing.set(false);
    }
  }

  private persist(profileChanged = false): Promise<void> {
    return this.onboarding.save(this.step(), this.draft(), profileChanged);
  }

  private hydrate(step: OnboardingStep | undefined, draft: OnboardingDraft | null): void {
    const user = this.auth.user();
    this.draft.set({
      account: {
        name: user?.name,
        currency: user?.currency ?? 'MXN',
        distance_unit: user?.distance_unit ?? 'km',
        volume_unit: user?.volume_unit ?? 'L',
        ...draft?.account,
      },
      vehicle: {
        vehicle_type: 'car',
        emissions_sticker: 'none',
        default_fuel_grade: 'regular',
        gauge_total_segments: 8,
        ...draft?.vehicle,
      },
    });
    this.step.set(step && step !== 'done' ? step : 'account');
    this.hydrated.set(true);
  }
}
