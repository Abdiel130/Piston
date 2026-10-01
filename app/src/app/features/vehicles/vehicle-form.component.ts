import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleService, type VehicleFields, type VehicleHistory } from '../../core/data/vehicle.service';
import type { FuelGrade, StickerColor, Transmission, Vehicle, VehicleStatus, VehicleType } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, readNumber, readText, type Errors } from '../capture/capture-form';
import {
  FUEL_GRADES,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  MIN_YEAR,
  STICKERS,
  TRANSMISSIONS,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from './vehicle-options';

/**
 * Lo que se ve en el formulario. Las cifras van en la unidad del usuario
 * (`odometer` en mi si eligió millas); se pasan a km y litros al guardar.
 */
interface FormValue {
  nickname: string;
  make: string;
  model: string;
  year: number | null;
  trim: string;
  vehicle_type: VehicleType;
  transmission: Transmission | null;
  engine_displacement_l: number | null;
  color: string;
  vin: string;
  license_plate: string;
  emissions_sticker: StickerColor;
  default_fuel_grade: FuelGrade;
  tank: number | null;
  gauge_total_segments: number;
  factory_efficiency: number | null;
  oil_capacity: number | null;
  oil_spec: string;
  tire_pressure_front_psi: number | null;
  tire_pressure_rear_psi: number | null;
  odometer: number | null;
  purchase_date: string;
  purchase_price: number | null;
  purchase_odometer: number | null;
  sale_date: string;
  sale_price: number | null;
  sale_odometer: number | null;
  status: VehicleStatus;
  notes: string;
}

type Field = keyof FormValue;

const BLANK: FormValue = {
  nickname: '',
  make: '',
  model: '',
  year: null,
  trim: '',
  vehicle_type: 'car',
  transmission: null,
  engine_displacement_l: null,
  color: '',
  vin: '',
  license_plate: '',
  emissions_sticker: 'none',
  default_fuel_grade: 'regular',
  tank: null,
  gauge_total_segments: 8,
  factory_efficiency: null,
  oil_capacity: null,
  oil_spec: '',
  tire_pressure_front_psi: null,
  tire_pressure_rear_psi: null,
  odometer: null,
  purchase_date: '',
  purchase_price: null,
  purchase_odometer: null,
  sale_date: '',
  sale_price: null,
  sale_odometer: null,
  status: 'active',
  notes: '',
};

const THIS_YEAR = new Date().getFullYear();

/**
 * Alta y ficha de un vehículo.
 *
 * Con `id` es la ficha: muestra lo guardado y permite corregirlo. Sin `id`
 * da de alta uno nuevo. Las reglas (odómetro por lecturas, un solo
 * principal, borrar solo sin historial) viven en `VehicleService`.
 */
@Component({
  selector: 'pst-vehicle-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './vehicle-form.component.html',
  styleUrls: ['../capture/capture.scss', './vehicle-form.component.scss'],
})
export class VehicleFormComponent {
  private readonly store = inject(OfflineStore);
  private readonly vehicles = inject(VehicleService);
  private readonly router = inject(Router);
  protected readonly units = inject(UnitsService);

  /** Parámetro de ruta. Vacío en el alta. */
  readonly id = input<string>();

  protected readonly vehicleTypes = VEHICLE_TYPES;
  protected readonly transmissions = TRANSMISSIONS;
  protected readonly stickers = STICKERS;
  protected readonly fuelGrades = FUEL_GRADES;
  protected readonly statuses = VEHICLE_STATUSES;

  protected readonly editing = computed(() => !!this.id());
  protected readonly form = signal<FormValue>({ ...BLANK });
  protected readonly makePrimary = signal(false);
  private readonly hydrated = signal(false);

  /** La fila guardada, en vivo: el sync puede traer cambios de otro dispositivo. */
  protected readonly saved = this.store.liveFrom(
    this.id,
    async (id) => (id ? ((await this.store.get<Vehicle>('vehicles', id)) ?? null) : null),
    undefined as Vehicle | null | undefined,
  );
  /** Se borró (aquí o en otro dispositivo) o el enlace no es válido. */
  protected readonly missing = computed(() => this.editing() && this.saved() === null);

  protected readonly history = signal<VehicleHistory | null>(null);
  protected readonly hasHistory = computed(() => {
    const h = this.history();
    return !h || h.fuel + h.services + h.expenses + h.other > 0;
  });
  /** Cuántos vehículos hay: el primero siempre es el principal. */
  private readonly count = this.store.liveSignal(
    async () => (await this.store.list<Vehicle>('vehicles')).length,
    -1,
  );
  protected readonly firstVehicle = computed(() => this.count() === 0);

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly notice = signal<string | null>(null);

  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected readonly title = computed(() => {
    if (!this.editing()) return 'Nuevo vehículo';
    const v = this.saved();
    return v ? (v.nickname ?? `${v.make} ${v.model}`) : 'Vehículo';
  });

  protected readonly perSegment = computed(() => {
    const { tank, gauge_total_segments } = this.form();
    return tank && tank > 0 ? (tank / gauge_total_segments).toFixed(1) : null;
  });

  protected readonly errors = computed<Errors<Field>>(() => {
    const f = this.form();
    const e: Errors<Field> = {};
    const toKm = (value: number | null) => this.units.toOdometerKm(value);
    const toLiters = (value: number | null) => this.units.toLiters(value);

    if (!f.make.trim()) e.make = 'Indica la marca.';
    else if (f.make.trim().length > 60) e.make = 'Máximo 60 caracteres.';
    if (!f.model.trim()) e.model = 'Indica el modelo.';
    else if (f.model.trim().length > 80) e.model = 'Máximo 80 caracteres.';
    if (f.year === null || !Number.isInteger(f.year) || f.year < MIN_YEAR || f.year > THIS_YEAR + 1) {
      e.year = `Un año entre ${MIN_YEAR} y ${THIS_YEAR + 1}.`;
    }
    if (f.vin.trim() && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(f.vin.trim())) {
      e.vin = 'El VIN tiene 17 caracteres, sin I, O ni Q.';
    }
    if (f.license_plate.trim().length > 15) e.license_plate = 'Máximo 15 caracteres.';

    const tank = toLiters(f.tank);
    if (tank === null || tank <= 0 || tank > 500) e.tank = 'Indica la capacidad del tanque.';
    const efficiency = this.units.toKmPerLiter(f.factory_efficiency);
    if (efficiency !== null && (efficiency <= 0 || efficiency > 999.99)) e.factory_efficiency = 'Fuera de rango.';
    const oil = toLiters(f.oil_capacity);
    if (oil !== null && (oil <= 0 || oil > 99.99)) e.oil_capacity = 'Fuera de rango.';
    if (f.engine_displacement_l !== null && (f.engine_displacement_l <= 0 || f.engine_displacement_l > 99.9)) {
      e.engine_displacement_l = 'Fuera de rango.';
    }
    for (const key of ['tire_pressure_front_psi', 'tire_pressure_rear_psi'] as const) {
      const psi = f[key];
      if (psi !== null && (!Number.isInteger(psi) || psi <= 0 || psi > 150)) e[key] = 'PSI enteros, hasta 150.';
    }

    const odometer = toKm(f.odometer);
    if (odometer === null || !Number.isInteger(f.odometer) || odometer < 0 || odometer > LIMITS.km) {
      e.odometer = 'Un número entero.';
    }
    const bought = toKm(f.purchase_odometer);
    if (bought !== null && (bought < 0 || (odometer !== null && bought > odometer))) {
      e.purchase_odometer = 'No puede ser mayor que el actual.';
    }
    if (f.purchase_price !== null && (f.purchase_price < 0 || f.purchase_price > LIMITS.money10)) {
      e.purchase_price = 'Fuera de rango.';
    }
    if (f.status === 'sold') {
      const sold = toKm(f.sale_odometer);
      if (sold !== null && bought !== null && sold < bought) e.sale_odometer = 'Menor que al comprarlo.';
      if (f.sale_price !== null && (f.sale_price < 0 || f.sale_price > LIMITS.money10)) e.sale_price = 'Fuera de rango.';
      if (f.sale_date && f.purchase_date && f.sale_date < f.purchase_date) e.sale_date = 'Antes de la compra.';
    }
    return e;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  constructor() {
    // Se hidrata UNA vez: después el formulario es del usuario, y un cambio
    // que traiga el sync no debe pisar lo que está escribiendo.
    effect(() => {
      const id = this.id();
      const vehicle = this.saved();
      if (untracked(this.hydrated)) return;
      if (!id) {
        untracked(() => this.hydrated.set(true));
        return;
      }
      if (vehicle) {
        untracked(() => {
          this.form.set(this.toForm(vehicle));
          this.hydrated.set(true);
          void this.vehicles.history(vehicle.id).then((history) => this.history.set(history));
        });
      }
    });
  }

  protected set<K extends Field>(key: K, value: FormValue[K]): void {
    this.form.update((form) => ({ ...form, [key]: value }));
    this.notice.set(null);
  }

  protected bumpSegments(delta: number): void {
    const next = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, this.form().gauge_total_segments + delta));
    this.set('gauge_total_segments', next);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    if (!this.valid() || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    const original = this.saved() ?? null;
    const fields = this.toFields(this.form(), original);
    const odometer = this.keep(
      this.form().odometer,
      original?.current_odometer_km ?? null,
      (km) => this.units.inputDistance(km),
      (value) => this.units.toOdometerKm(value),
    )!;
    try {
      const id = this.id();
      if (id) {
        await this.vehicles.update(id, fields, odometer);
        this.submitted.set(false);
        this.notice.set('Cambios guardados.');
      } else {
        await this.vehicles.create(fields, odometer, this.makePrimary());
        await this.router.navigateByUrl('/settings');
      }
    } catch (error) {
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async setPrimary(): Promise<void> {
    const id = this.id();
    if (!id) return;
    try {
      await this.vehicles.setPrimary(id);
      this.notice.set('Ahora es tu vehículo principal.');
    } catch (error) {
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo cambiar.');
    }
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    try {
      await this.vehicles.remove(id);
      await this.router.navigateByUrl('/settings');
    } catch (error) {
      this.confirmDelete.set(false);
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo borrar.');
    }
  }

  private toForm(v: Vehicle): FormValue {
    const u = this.units;
    return {
      nickname: v.nickname ?? '',
      make: v.make,
      model: v.model,
      year: v.year,
      trim: v.trim ?? '',
      vehicle_type: v.vehicle_type,
      transmission: v.transmission,
      engine_displacement_l: v.engine_displacement_l,
      color: v.color ?? '',
      vin: v.vin ?? '',
      license_plate: v.license_plate ?? '',
      emissions_sticker: v.emissions_sticker,
      default_fuel_grade: v.default_fuel_grade,
      tank: u.inputVolume(v.tank_capacity_l),
      gauge_total_segments: v.gauge_total_segments,
      factory_efficiency: u.inputEfficiency(v.factory_km_per_liter),
      oil_capacity: u.inputVolume(v.oil_capacity_l),
      oil_spec: v.oil_spec ?? '',
      tire_pressure_front_psi: v.tire_pressure_front_psi,
      tire_pressure_rear_psi: v.tire_pressure_rear_psi,
      odometer: u.inputDistance(v.current_odometer_km),
      purchase_date: v.purchase_date ?? '',
      purchase_price: v.purchase_price,
      purchase_odometer: u.inputDistance(v.purchase_odometer_km),
      sale_date: v.sale_date ?? '',
      sale_price: v.sale_price,
      sale_odometer: u.inputDistance(v.sale_odometer_km),
      status: v.status,
      notes: v.notes ?? '',
    };
  }

  /**
   * Valor base a guardar para una cifra convertida. Si el usuario no la tocó,
   * se conserva la guardada: 51 L vistos como 13.47 gal volverían como
   * 50.99 L, y guardar sin cambiar nada no debe mover los datos.
   */
  private keep(
    value: number | null,
    original: number | null,
    toInput: (base: number | null) => number | null,
    toBase: (value: number | null) => number | null,
  ): number | null {
    return value === toInput(original) ? original : toBase(value);
  }

  private toFields(f: FormValue, original: Vehicle | null): VehicleFields {
    const u = this.units;
    const sold = f.status === 'sold';
    const liters = (value: number | null, base: number | null) =>
      this.keep(value, base, (l) => u.inputVolume(l), (v) => u.toLiters(v));
    const km = (value: number | null, base: number | null) =>
      this.keep(value, base, (k) => u.inputDistance(k), (v) => u.toOdometerKm(v));
    return {
      nickname: f.nickname,
      make: f.make,
      model: f.model,
      year: f.year!,
      trim: f.trim,
      vehicle_type: f.vehicle_type,
      transmission: f.transmission,
      engine_displacement_l: f.engine_displacement_l,
      color: f.color,
      vin: f.vin,
      license_plate: f.license_plate,
      emissions_sticker: f.emissions_sticker,
      default_fuel_grade: f.default_fuel_grade,
      tank_capacity_l: liters(f.tank, original?.tank_capacity_l ?? null)!,
      gauge_total_segments: f.gauge_total_segments,
      factory_km_per_liter: this.keep(
        f.factory_efficiency,
        original?.factory_km_per_liter ?? null,
        (e) => u.inputEfficiency(e),
        (v) => u.toKmPerLiter(v),
      ),
      oil_capacity_l: liters(f.oil_capacity, original?.oil_capacity_l ?? null),
      oil_spec: f.oil_spec,
      tire_pressure_front_psi: f.tire_pressure_front_psi,
      tire_pressure_rear_psi: f.tire_pressure_rear_psi,
      purchase_date: f.purchase_date || null,
      purchase_price: f.purchase_price,
      purchase_odometer_km: km(f.purchase_odometer, original?.purchase_odometer_km ?? null),
      // Los datos de venta solo existen si se vendió; si se reactiva, se limpian.
      sale_date: sold ? f.sale_date || null : null,
      sale_price: sold ? f.sale_price : null,
      sale_odometer_km: sold ? km(f.sale_odometer, original?.sale_odometer_km ?? null) : null,
      status: f.status,
      notes: f.notes,
    };
  }
}
